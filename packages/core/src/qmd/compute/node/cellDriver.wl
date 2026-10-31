(* Persistent cell driver: reads one JSON request {id, code, params?} per stdin line and keeps one session (the Global` context) for the life of the process.
   Params become Global` symbols before the cell runs. A Manipulate last value gives a PNG frame at the requested values plus its controls.
   Each response is a line "\u0001LABSHELF\u0001" + JSON {id, text|latex|error, controls?}; anything the cell prints goes to stdout before it.
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

(* Manipulate holds its arguments; the body is rendered with each control symbol replaced by its value, like one frame of the live view. *)
toFrame[Manipulate[body_, rest___], params_Association] := Catch[Module[{controls, rules, frame},
  controls = parseControl /@ Cases[Hold[rest], spec_ /; ! MatchQ[Unevaluated[spec], _Rule | _RuleDelayed] :> Hold[spec]];
  rules = (Replace[#["symbol"], Hold[s_] :> (HoldPattern[s] -> #2)] &) @@@ ({#, requested[#, params]} & /@ controls);
  frame = ReleaseHold[Hold[body] /. rules];
  frameResult[<|"text" -> "data:image/png;base64," <> BaseEncode[pngBytes[frame]],
    "controls" -> (Function[c, Append[c["control"], "value" -> jsonValue[requested[c, params]]]] /@ controls)|>]
], unsupported, frameResult[<|"error" -> #1|>] &];
toFrame[other_, _] := other;

(* Evaluates the code in Global`; Print output and messages go to temporary streams so they can be told apart from the result. *)
evaluate[code_String, params_Association] := Module[{out, msg, result, printed, messages},
  out = OpenWrite[CharacterEncoding -> "UTF-8", FormatType -> OutputForm];
  msg = OpenWrite[CharacterEncoding -> "UTF-8"];
  result = Block[{$Output = {out}, $Messages = {msg}, $MessagePrePrint = oneLine},
    CheckAbort[toFrame[ToExpression[code], params], $Aborted]
  ];
  printed = readText[Close[out]];
  messages = StringTrim[readText[Close[msg]]];
  {Which[
    messages =!= "", <|"error" -> messages|>,
    MatchQ[result, frameResult[_Association]], First[result],
    result === $Failed || result === $Aborted, <|"error" -> ToString[result]|>,
    result === Null, <||>,
    StringQ[result], <|"text" -> result|>,
    True, <|"latex" -> Quiet[ToString[TeXForm[result]]]|>
  ], printed}
];

(* Written once after the startup, so output the kernel prints while it starts (a licence banner on stderr) is told apart from cell output. *)
announceReady[] := (
  WriteString["stdout", sentinel, ExportString[<|"ready" -> True|>, "RawJSON", "Compact" -> True], "\n"];
  Quiet[Flush["stdout"]]
);

main[] := Module[{line, request, id, code, params, invalid, outcome},
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
    (* No Check here: Check also sees the messages that evaluate redirects into the error text. *)
    outcome = evaluate[code, params];
    emit[id, outcome[[1]], outcome[[2]]]
  ]
];

End[];

LabshelfDriver`main[];
