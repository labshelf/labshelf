(* Persistent cell driver: reads one JSON request {id, code, params?, preview?} per stdin line and keeps one session (the Global` context) for the life of the process.
   Params become Global` symbols before the cell runs. A Manipulate last value gives a PNG frame at the requested values plus its controls.
   A Graphics or Graphics3D last value, or a Manipulate frame that renders to one, answers {text: PNG data URL, plot?: labshelf-plot spec JSON}.
   With preview: true, such a value that yields a spec answers the spec alone and the PNG is not rendered; anything else answers as without preview.
   Each response is a line "\u0001LABSHELF\u0001" + JSON {id, text|latex|error, plot?, controls?, warnings?}; anything the cell prints goes to stdout before it.
   Messages beside a result are warnings, one message per entry; the cell is an error only when there is no result.
   A math request is the line {id, math: {op, tex}} with op eval, numeric, solve or check and tex already normalised by the host. Its response is
   {id, math: {state, latex?, readAs, rewrites, messages, counterexample?, condition?}} with state value, proved, sampled, differs, conditional, unread
   or failed; counterexample is {point: {name: number}, lhs, rhs}. The host replaces rewrites with the ones its normaliser applied.
   The math evaluators live in mathDriver.wl, loaded from beside this file, so every build that copies this driver copies that one too.
   Run as: WolframKernel -noprompt -script cellDriver.wl. wolframscript -file cannot host it: wolframscript reads all of stdin
   up to end of file before it starts the script, so the kernel next to wolframscript is launched directly. *)

$CharacterEncoding = "UTF-8";
$HistoryLength = 0;

(* The driver's own symbols live in their own context so a cell that defines "emit" or "line" cannot break the loop. *)
Begin["LabshelfDriver`"];

sentinel = FromCharacterCode[1] <> "LABSHELF" <> FromCharacterCode[1];

readText[file_] := Module[{text = Quiet[Import[file, "Text", CharacterEncoding -> "UTF-8"]]},
  Quiet[DeleteFile[file]];
  If[StringQ[text], text, ""]
];

(* The printed text ends its line first so the sentinel always starts one. *)
emit[id_, payload_Association, printed_String] := (
  If[printed =!= "",
    WriteString["stdout", printed, If[StringEndsQ[printed, "\n"], "", "\n"]]
  ];
  (* ExportString gives UTF-8 bytes as characters for non-ASCII text; decode them so the output stream encodes them once. *)
  WriteString["stdout", sentinel,
    FromCharacterCode[ToCharacterCode[ExportString[Join[<|"id" -> id|>, payload], "RawJSON", "Compact" -> True]], "UTF-8"], "\n"];
  Quiet[Flush["stdout"]]
);

(* Messages show their arguments as one line of input text instead of two-dimensional output. *)
oneLine[HoldForm[expr_]] := ToString[Unevaluated[expr], InputForm];
oneLine[expr_] := ToString[expr, InputForm];

(* A param name is a plain symbol name: no context mark, nothing ToExpression could read as code. *)
validName[name_] := StringQ[name] && StringMatchQ[name, RegularExpression["[A-Za-z][A-Za-z0-9]*"]];

(* The name is checked first, so parsing it yields exactly one Global` symbol; the value is the RawJSON value, never parsed. *)
setParam[name_String, value_] := Replace[ToExpression["Global`" <> name, InputForm, Hold], Hold[s_Symbol] :> (s = value)];

(* JSON numbers: integers stay integers, other exact numbers become reals. *)
jsonNumber[x_] := If[IntegerQ[x], x, N[x]];
jsonValue[x_] := Which[NumericQ[x], jsonNumber[x], StringQ[x] || BooleanQ[x], x, True, ToString[x, InputForm]];

(* One control spec, held: <|"symbol" -> Hold[sym], "initial" -> value, "control" -> CellControl|>, or Throw[spec text, unsupported]. *)
slider[Hold[v_Symbol], init_, min_, max_, step_] := If[NumericQ[min] && NumericQ[max] && (step === None || NumericQ[step]) && NumericQ[init],
  <|"symbol" -> Hold[v], "initial" -> init, "control" -> Join[
    <|"name" -> SymbolName[Unevaluated[v]], "kind" -> "slider", "min" -> jsonNumber[min], "max" -> jsonNumber[max]|>,
    If[step === None, <||>, <|"step" -> jsonNumber[step]|>], <|"value" -> jsonNumber[init]|>]|>,
  $Failed];
choice[Hold[v_Symbol], init_, choices_List] := <|"symbol" -> Hold[v], "initial" -> init, "choices" -> choices, "control" ->
  If[choices === {True, False},
    <|"name" -> SymbolName[Unevaluated[v]], "kind" -> "checkbox", "value" -> init|>,
    <|"name" -> SymbolName[Unevaluated[v]], "kind" -> "select", "choices" -> jsonValue /@ choices, "value" -> jsonValue[init]|>]|>;
SetAttributes[control, HoldAll];
control[{v_Symbol, min_, max_}] := slider[Hold[v], min, min, max, None];
control[{v_Symbol, min_, max_, step_}] /; ! ListQ[Unevaluated[min]] := slider[Hold[v], min, min, max, step];
control[{{v_Symbol, init_, ___}, min_, max_}] /; ! ListQ[Unevaluated[min]] := slider[Hold[v], init, min, max, None];
control[{{v_Symbol, init_, ___}, min_, max_, step_}] := slider[Hold[v], init, min, max, step];
control[{v_Symbol, choices_List}] := With[{c = choices}, If[c === {}, $Failed, choice[Hold[v], First[c], c]]];
control[{{v_Symbol, init_, ___}, choices_List}] := choice[Hold[v], init, choices];
control[_] := $Failed;
parseControl[Hold[spec_]] := With[{parsed = control[spec]},
  If[AssociationQ[parsed], parsed, Throw["Unsupported Manipulate control " <> ToString[Unevaluated[spec], InputForm], unsupported]]];

(* A requested value replaces the initial one; for a select or checkbox it must be one of the choices (matched by its JSON form). *)
requested[c_Association, params_Association] := With[{name = c["control"]["name"]},
  Which[
    ! KeyExistsQ[params, name], c["initial"],
    KeyExistsQ[c, "choices"], SelectFirst[c["choices"], jsonValue[#] === params[name] &, c["initial"]],
    True, params[name]
  ]];

(* The frame is rebuilt from its pixels and written without metadata, so the same values give the same bytes (Export adds a dated exif profile). *)
pngBytes[expr_] := Module[{image = Image[ImageData[ImportByteArray[ExportByteArray[expr, "PNG"], "PNG"], "Byte"], "Byte"], bytes},
  bytes = Quiet[ExportByteArray[image, "PNG", IncludeMetaInformation -> None]];
  If[ByteArrayQ[bytes], bytes, ExportByteArray[image, "PNG"]]
];

(* labshelf-plot v1 spec of a graphic (see packages/core/src/qmd/item/plotSpec.ts). Any shape it cannot map throws to specTag, which means no spec. *)
noSpec[] := Throw[None, specTag];
plotContainer = Annotation | Tooltip | Style | StatusArea | Mouseover | Hyperlink | EventHandler | GraphicsGroup;
plotDirective = _RGBColor | _Hue | _GrayLevel | _CMYKColor | _Opacity | _Thickness | _AbsoluteThickness | _PointSize | _AbsolutePointSize |
  _Dashing | _AbsoluteDashing | _Directive | _EdgeForm | _FaceForm | _Arrowheads | _CapForm | _JoinForm |
  _Specularity | _Glow | (Lighting -> _);
containerQ[e_] := MatchQ[Head[e], plotContainer] && Length[e] >= 1;

(* A coordinate rounded to 4 significant digits (a zero stays 0), or Null when it is not a finite real. *)
round4[x_] := With[{n = Quiet[N[x]]}, Which[
  Head[n] =!= Real, Null,
  n == 0, 0,
  True, N[Round[n, 10^(Floor[Log10[Abs[n]]] - 3)]]
]];

pointQ[p_, d_] := ListQ[p] && Length[p] == d && NoneTrue[p, ListQ];
pointRows[pts_, d_] := If[ListQ[pts] && AllTrue[pts, pointQ[#, d] &], pts, noSpec[]];
segmentsQ[pts_] := ListQ[pts] && pts =!= {} && AllTrue[pts, ListQ[#] && # =!= {} && ListQ[First[#]] &];
axisNames[d_] := Take[{"x", "y", "z"}, d];
columns[rows_, d_] := AssociationThread[axisNames[d], If[rows === {}, ConstantArray[{}, d], Transpose[rows]]];

(* Line[{seg1, seg2, ...}] is one trace with the segments joined by a Null point; a non-finite coordinate is Null. *)
lineTrace[pts_, d_] := Module[{rows},
  rows = If[segmentsQ[pts],
    With[{segs = pointRows[#, d] & /@ pts}, Join @@ Riffle[segs, ConstantArray[{ConstantArray[Null, d]}, Length[segs] - 1]]],
    pointRows[pts, d]];
  If[rows =!= {}, Sow[Join[<|"type" -> "line"|>, columns[Map[round4, rows, {2}], d]]]]
];
(* A point with a coordinate that is not a finite real is dropped. *)
pointsTrace[p_, d_] := Module[{rows},
  rows = Select[Map[round4, If[pointQ[p, d], {p}, pointRows[p, d]], {2}], FreeQ[#, Null] &];
  If[rows =!= {}, Sow[Join[<|"type" -> "points"|>, columns[rows, d]]]]
];

(* Explicit primitives (2D after Normal, 3D outside a GraphicsComplex with polygons): Line and Point only. *)
walkPrims[l_List, d_] := Scan[walkPrims[#, d] &, l];
walkPrims[e_?containerQ, d_] := walkPrims[First[e], d];
walkPrims[plotDirective, _] := Null;
walkPrims[Line[pts_, ___], d_] := lineTrace[pts, d];
walkPrims[Point[p_, ___], d_] := pointsTrace[p, d];
walkPrims[_, _] := noSpec[];

(* Index lists of a polygon inside a GraphicsComplex, fanned into 0-based triangles. *)
polygonIndices[idx_] := Which[VectorQ[idx, IntegerQ], {idx}, ListQ[idx] && AllTrue[idx, VectorQ[#, IntegerQ] &], idx, True, noSpec[]];
fanFaces[ix_List, n_] := If[Length[ix] < 3 || Min[ix] < 1 || Max[ix] > n, noSpec[],
  Table[{ix[[1]], ix[[i]], ix[[i + 1]]} - 1, {i, 2, Length[ix] - 1}]];
meshFaces[l_List, n_] := Scan[meshFaces[#, n] &, l];
meshFaces[e_?containerQ, n_] := meshFaces[First[e], n];
meshFaces[plotDirective, _] := Null;
meshFaces[_Line, _] := Null;
meshFaces[Polygon[idx_, ___], n_] := Sow[Join @@ (fanFaces[#, n] &) /@ polygonIndices[idx]];
meshFaces[_, _] := noSpec[];
meshTrace[v_, prims_] := Module[{faces, vertices},
  If[! (MatrixQ[v] && Last[Dimensions[v]] == 3), noSpec[]];
  faces = Join @@ Reap[meshFaces[prims, Length[v]]][[2, All]];
  faces = Join @@ faces;
  If[faces === {} || Length[faces] > 20000, noSpec[]];
  vertices = Map[round4, v, {2}];
  If[! FreeQ[vertices, Null], noSpec[]];
  Sow[<|"type" -> "mesh", "vertices" -> vertices, "faces" -> faces|>]
];
walk3D[l_List] := Scan[walk3D, l];
walk3D[e_?containerQ] := walk3D[First[e]];
walk3D[plotDirective] := Null;
walk3D[gc : GraphicsComplex[v_, prims_, ___]] := If[FreeQ[prims, _Polygon], walkPrims[Normal[Graphics3D[gc]][[1]], 3], meshTrace[v, prims]];
walk3D[e_] := walkPrims[e, 3];

(* A label: strings as they are, Style and HoldForm unwrapped, None, Automatic or {} none, anything else its InputForm. *)
SetAttributes[heldLabel, HoldAll];
heldLabel[s_String] := s;
heldLabel[None | Automatic | {}] := None;
heldLabel[HoldForm[x_]] := heldLabel[x];
heldLabel[Style[x_, ___]] := heldLabel[x];
heldLabel[x_] := ToString[Unevaluated[x], InputForm];
label[x_] := heldLabel[x];
(* An axis label: Plot resolves Automatic (and AxesLabel -> {}) to HoldForm[var] of its plot variable, while it wraps
   every label the user gave in a HoldForm of its own (a symbol x is stored as HoldForm[HoldForm[x]]), so a bare
   HoldForm[symbol] is the resolved Automatic and gives no label. *)
axisLabel[HoldForm[_Symbol]] := None;
axisLabel[x_] := label[x];
optionValue[g_, name_] := Lookup[Cases[Options[g, name], _Rule | _RuleDelayed], name, None];

plotSpec[g_] := Module[{dim = If[Head[g] === Graphics3D, 3, 2], traces, faces, title, axesOpt, labels},
  traces = Join @@ Reap[If[dim == 2, walkPrims[Normal[g][[1]], 2], walk3D[g[[1]]]]][[2]];
  faces = Total[Length[#["faces"]] & /@ Select[traces, #["type"] === "mesh" &]];
  If[traces === {} || faces > 20000, noSpec[]];
  title = label[optionValue[g, PlotLabel]];
  axesOpt = optionValue[g, AxesLabel];
  labels = If[ListQ[axesOpt], PadRight[Take[axesOpt, UpTo[dim]], dim, None], If[dim == 2, {axesOpt, None}, {None, None, axesOpt}]];
  Join[<|"v" -> 1, "dim" -> dim|>, If[StringQ[title], <|"title" -> title|>, <||>],
    <|"axes" -> AssociationThread[axisNames[dim], (With[{l = axisLabel[#]}, If[StringQ[l], <|"label" -> l|>, <||>]] &) /@ labels],
      "traces" -> traces|>]
];

(* The spec as JSON text decoded like emit does, or None; never fails the cell and never writes to stdout. *)
specJson[g_] := Quiet[Check[With[{spec = Catch[plotSpec[g], specTag]},
  If[AssociationQ[spec], FromCharacterCode[ToCharacterCode[ExportString[spec, "RawJSON", "Compact" -> True]], "UTF-8"], None]], None]];
plotEntry[g_] := With[{json = specJson[g]}, If[StringQ[json], <|"plot" -> json|>, <||>]];

(* The graphic a value draws: a Graphics or Graphics3D, or the one inside Legended; None for anything else. *)
graphicOf[g : (_Graphics | _Graphics3D)] := g;
graphicOf[Legended[g : (_Graphics | _Graphics3D), ___]] := g;
graphicOf[_] := None;
plotOf[expr_] := With[{g = graphicOf[expr]}, If[g === None, <||>, plotEntry[g]]];

pngText[expr_] := "data:image/png;base64," <> BaseEncode[pngBytes[expr]];
(* The spec JSON of the graphic a value draws, or None. *)
specOf[expr_] := With[{g = graphicOf[expr]}, If[g === None, None, specJson[g]]];

(* Manipulate holds its arguments; the body is evaluated with each control symbol replaced by its value, like one frame of the live view.
   The frame rides along unrendered, so evaluate renders its PNG only when the answer needs it and builds its spec after the message capture. *)
toFrame[Manipulate[body_, rest___], params_Association] := Catch[Module[{controls, rules, frame},
  controls = parseControl /@ Cases[Hold[rest], spec_ /; ! MatchQ[Unevaluated[spec], _Rule | _RuleDelayed] :> Hold[spec]];
  rules = (Replace[#["symbol"], Hold[s_] :> (HoldPattern[s] -> #2)] &) @@@ ({#, requested[#, params]} & /@ controls);
  frame = ReleaseHold[Hold[body] /. rules];
  frameResult[<|"controls" -> (Function[c, Append[c["control"], "value" -> jsonValue[requested[c, params]]]] /@ controls)|>, frame]
], unsupported, frameResult[<|"error" -> #1|>, None] &];
toFrame[other_, _] := other;

(* Evaluates expr with Print output and messages sent to temporary streams so they can be told apart from the result: {result, printed, messages}.
   The message stream never wraps, so each message stays on one line. *)
SetAttributes[captured, HoldFirst];
captured[expr_] := Module[{out, msg, result},
  out = OpenWrite[CharacterEncoding -> "UTF-8", FormatType -> OutputForm];
  msg = OpenWrite[CharacterEncoding -> "UTF-8", PageWidth -> Infinity];
  result = Block[{$Output = {out}, $Messages = {msg}, $MessagePrePrint = oneLine}, CheckAbort[expr, $Aborted]];
  {result, readText[Close[out]], readText[Close[msg]]}
];

(* Evaluates the code in Global`. A Manipulate frame's PNG is rendered in a second capture whose output and messages count as the cell's,
   unless a preview answers the frame's spec alone. Messages beside a result become its warnings; the messages are the error only when
   there is no result: $Failed, $Aborted, or Null with no printed text. *)
evaluate[code_String, params_Association, preview_] := Module[{result, printed, messages, spec, png, morePrinted, moreMessages, warnings, answer},
  {result, printed, messages} = captured[toFrame[ToExpression[code], params]];
  If[MatchQ[result, frameResult[_Association, _]] && ! KeyExistsQ[result[[1]], "error"],
    spec = If[preview && StringTrim[messages] === "", specOf[result[[2]]], None];
    If[StringQ[spec],
      result = frameResult[Append[result[[1]], "plot" -> spec], None],
      {png, morePrinted, moreMessages} = captured[pngText[result[[2]]]];
      printed = printed <> morePrinted;
      messages = messages <> moreMessages;
      result = If[png === $Aborted, $Aborted, frameResult[Join[<|"text" -> png|>, result[[1]]], result[[2]]]]
    ]
  ];
  messages = StringTrim[messages];
  warnings = Select[StringTrim /@ StringSplit[messages, "\n"], # =!= "" &];
  answer = Which[
    result === $Failed || result === $Aborted, <|"error" -> If[messages =!= "", messages, ToString[result]]|>,
    result === Null && messages =!= "" && StringTrim[printed] === "", <|"error" -> messages|>,
    MatchQ[result, frameResult[_Association, None]], result[[1]],
    MatchQ[result, frameResult[_Association, _]], Join[result[[1]], plotOf[result[[2]]]],
    result === Null, <||>,
    StringQ[result], <|"text" -> result|>,
    graphicOf[result] =!= None, With[{json = specJson[graphicOf[result]]},
      If[preview && StringQ[json], <|"plot" -> json|>, Join[<|"text" -> pngText[result]|>, If[StringQ[json], <|"plot" -> json|>, <||>]]]],
    True, <|"latex" -> Quiet[ToString[TeXForm[result]]]|>
  ];
  (* An error made of the messages does not repeat them as warnings. *)
  If[warnings =!= {} && Lookup[answer, "error", None] =!= messages, answer = Append[answer, "warnings" -> warnings]];
  {answer, printed}
];

(* mathAnswer: the math request evaluators, which use captured and oneLine above. *)
Get[FileNameJoin[{DirectoryName[$InputFileName], "mathDriver.wl"}]];

(* Written once after the startup, so output the kernel prints while it starts (a licence banner on stderr) is told apart from cell output. *)
announceReady[] := (
  WriteString["stdout", sentinel, ExportString[<|"ready" -> True|>, "RawJSON", "Compact" -> True], "\n"];
  Quiet[Flush["stdout"]]
);

main[] := Module[{line, request, id, code, params, preview, invalid, outcome, math},
  announceReady[];
  While[True,
    (* PLATFORM: in a kernel run with -script, InputString reads one line of stdin as it arrives and gives EndOfFile at the end. *)
    line = InputString[""];
    If[! StringQ[line], Break[]];
    If[StringTrim[line] === "", Continue[]];
    (* RawJSON decodes UTF-8 itself, so it is given the bytes of the line as characters. *)
    request = Quiet[ImportString[FromCharacterCode[ToCharacterCode[line, "UTF-8"]], "RawJSON"]];
    If[! AssociationQ[request], Continue[]];
    id = Lookup[request, "id", None];
    math = Lookup[request, "math", None];
    If[IntegerQ[id] && AssociationQ[math],
      outcome = mathAnswer[math];
      emit[id, <|"math" -> outcome[[1]]|>, outcome[[2]]];
      Continue[]
    ];
    code = Lookup[request, "code", None];
    If[! IntegerQ[id] || ! StringQ[code], Continue[]];
    params = Lookup[request, "params", <||>];
    If[! AssociationQ[params], params = <||>];
    (* A bad name fails the whole request before any param is set or the cell runs. *)
    invalid = SelectFirst[Keys[params], ! validName[#] &, None];
    If[invalid =!= None,
      emit[id, <|"error" -> "Invalid parameter name " <> ToString[invalid]|>, ""];
      Continue[]
    ];
    KeyValueMap[setParam, params];
    preview = Lookup[request, "preview", False] === True;
    (* No Check here: Check also sees the messages that evaluate redirects into the error text. *)
    outcome = evaluate[code, params, preview];
    emit[id, outcome[[1]], outcome[[2]]]
  ]
];

End[];

LabshelfDriver`main[];
