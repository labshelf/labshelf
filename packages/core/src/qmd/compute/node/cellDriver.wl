(* Persistent cell driver: reads one JSON request per stdin line and keeps one session (the Global` context) for the life of the process.
   Each response is a line "\u0001LABSHELF\u0001" + JSON {id, text|latex|error}; anything the cell prints goes to stdout before it.
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

(* Evaluates the code in Global`; Print output and messages go to temporary streams so they can be told apart from the result. *)
evaluate[code_String] := Module[{out, msg, result, printed, messages},
  out = OpenWrite[CharacterEncoding -> "UTF-8", FormatType -> OutputForm];
  msg = OpenWrite[CharacterEncoding -> "UTF-8"];
  result = Block[{$Output = {out}, $Messages = {msg}, $MessagePrePrint = oneLine},
    CheckAbort[ToExpression[code], $Aborted]
  ];
  printed = readText[Close[out]];
  messages = StringTrim[readText[Close[msg]]];
  {Which[
    messages =!= "", <|"error" -> messages|>,
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

main[] := Module[{line, request, id, code, outcome},
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
    (* No Check here: Check also sees the messages that evaluate redirects into the error text. *)
    outcome = evaluate[code];
    emit[id, outcome[[1]], outcome[[2]]]
  ]
];

End[];

LabshelfDriver`main[];
