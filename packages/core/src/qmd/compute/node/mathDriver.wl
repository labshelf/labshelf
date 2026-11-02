(* Math requests of the cell driver: cellDriver.wl loads this file from beside itself and calls mathAnswer for each {id, math: {op, tex}} line.
   The TeX is parsed held, every symbol of the parse is checked against the allowlist before anything evaluates, and the op then runs in Global`
   (so definitions from earlier cells apply) under TimeConstrained. Nothing here defines or clears a Global` symbol: sample points are
   substituted with rules. Depends on captured and oneLine of cellDriver.wl. *)

Begin["LabshelfDriver`"];

(* System` math the parse may use: arithmetic, elementary and special functions, calculus, relations, constants, Rule and List. *)
mathAllowed = Association[(# -> True) & /@ {
  "Plus", "Times", "Power", "Sqrt", "Exp", "Log", "Log2", "Log10", "Surd", "CubeRoot",
  "Sin", "Cos", "Tan", "Cot", "Sec", "Csc", "ArcSin", "ArcCos", "ArcTan", "ArcCot", "ArcSec", "ArcCsc",
  "Sinh", "Cosh", "Tanh", "Coth", "Sech", "Csch", "ArcSinh", "ArcCosh", "ArcTanh", "ArcCoth", "ArcSech", "ArcCsch",
  "Abs", "Sign", "Floor", "Ceiling", "Round", "Max", "Min", "Mod", "GCD", "LCM", "Re", "Im", "Conjugate", "Arg",
  "Factorial", "Factorial2", "Binomial", "Gamma", "Beta", "LogGamma", "PolyGamma", "Zeta", "Erf", "Erfc",
  "BesselJ", "BesselY", "BesselI", "BesselK", "AiryAi", "AiryBi", "LegendreP", "HermiteH", "LaguerreL", "ChebyshevT", "ChebyshevU",
  "Sum", "Product", "Integrate", "Limit", "D", "Derivative",
  "Equal", "Unequal", "Less", "Greater", "LessEqual", "GreaterEqual",
  "Pi", "E", "I", "Infinity", "ComplexInfinity", "DirectedInfinity", "Degree", "EulerGamma", "GoldenRatio", "Catalan",
  "Rational", "Complex", "Rule", "List"}];

(* A Global` name starts with a letter and has only letters and digits; Unicode letters such as Greek pass. *)
mathGlobalName[name_String] := With[{chars = Characters[name]},
  chars =!= {} && LetterQ[First[chars]] && AllTrue[chars, LetterQ[#] || DigitQ[#] &]];

(* The single capitals TeXForm reads as System` symbols, and the formal symbols that stand for them as free variables (they cannot be assigned).
   E and I keep their System` meaning. *)
mathFormal = {System`C -> \[FormalCapitalC], System`D -> \[FormalCapitalD], System`K -> \[FormalCapitalK],
  System`N -> \[FormalCapitalN], System`O -> \[FormalCapitalO]};
mathFormalLetter = Association[(Hold @@ {#[[2]]}) -> SymbolName[#[[1]]] & /@ mathFormal];
mathFormalQ[Hold[s_Symbol]] := KeyExistsQ[mathFormalLetter, Hold[s]];

(* Every non-head occurrence of C, D, K, N or O in the held parse becomes its formal symbol; D and N used as heads stay. *)
mathFormalise[held_Hold] := Replace[held, mathFormal, {1, Infinity}, Heads -> False];

(* The name a variable is shown by: the letter for a formal symbol, the symbol name otherwise. *)
mathShowName[s_Symbol] := Lookup[mathFormalLetter, Hold[s], SymbolName[Unevaluated[s]]];
SetAttributes[mathShowName, HoldFirst];

mathSymbolAllowed[Hold[s_Symbol]] := With[{context = Context[Unevaluated[s]], name = SymbolName[Unevaluated[s]]},
  (context === "System`" && (KeyExistsQ[mathAllowed, name] || mathFormalQ[Hold[s]])) || (context === "Global`" && mathGlobalName[name])];

(* The variable v of a Global` denominator symbol dv, as Hold[v], or None: System`C … System`O for those letters (mathFormalise turns them
   into formal symbols later), else a Global` symbol unless v names another System` symbol. *)
mathOperatorVar[Hold[dv_Symbol]] := Module[{name = SymbolName[Unevaluated[dv]], var},
  If[Context[Unevaluated[dv]] =!= "Global`" || ! StringStartsQ[name, "d"], Return[None, Module]];
  var = StringDrop[name, 1];
  If[! mathGlobalName[var], Return[None, Module]];
  Which[
    MemberQ[SymbolName /@ First /@ mathFormal, var], ToExpression["System`" <> var, InputForm, Hold],
    Names["System`" <> var] =!= {}, None,
    True, ToExpression["Global`" <> var, InputForm, Hold]]];

SetAttributes[mathKeep, HoldAll];

(* The arguments of a held product as one Hold: when one of them is the operator d/dv and factors follow it, mathKeep[D[X, v]] with the factors
   before it kept in front; None otherwise. Arguments are taken by position (Times patterns would match in any order). *)
mathOperatorTimes[args_Hold] := Module[{at, var},
  at = FirstPosition[args, Times[Global`d, Power[_Symbol, -1]], None, {1}, Heads -> False];
  If[at === None || First[at] === Length[args], Return[None, Module]];
  at = First[at];
  var = mathOperatorVar[Replace[Extract[args, {at}, Hold], Hold[Times[Global`d, Power[dv_Symbol, -1]]] :> Hold[dv]]];
  If[var === None, Return[None, Module]];
  Replace[{Take[args, at - 1], Drop[args, at], var}, {
    {Hold[], Hold[x_], Hold[w_]} :> mathKeep[D[x, w]],
    {Hold[], Hold[x__], Hold[w_]} :> mathKeep[D[Times[x], w]],
    {Hold[a__], Hold[x_], Hold[w_]} :> mathKeep[Times[a, D[x, w]]],
    {Hold[a__], Hold[x__], Hold[w_]} :> mathKeep[Times[a, D[Times[x], w]]]}]];

(* One pass of the derivative operator over the held parse: (d/dv)*X becomes D[X, v]. Nothing evaluates. The product is matched as t_Times and
   its arguments spliced out with Delete, since a Times[args__] pattern binds the whole product through Flat. *)
mathOperatorPass[held_Hold] :=
  Replace[held, t_Times :> With[{r = mathOperatorTimes[Delete[Hold[t], {1, 0}]]}, r /; r =!= None], {0, Infinity}] /. mathKeep[e_] :> e;

(* The derivative operator rewritten until no (d/dv)*X is left. *)
mathOperators[held_Hold] := FixedPoint[mathOperatorPass, held, 20];

(* The first symbol of the held parse the allowlist refuses, as Hold[symbol], or None. The outer Hold is the parse's own and is dropped once. *)
mathRefused[held_Hold] := SelectFirst[
  DeleteCases[Cases[held, s_Symbol :> Hold[s], {0, Infinity}, Heads -> True], Hold[Hold], 1, 1],
  ! mathSymbolAllowed[#] &, None];

(* Message text from captured as one string per message: a line that starts with Name::tag begins a message, any other line continues it. *)
mathMessages[text_String] := Module[{lines = Select[StringTrim /@ StringSplit[text, "\n"], # =!= "" &]},
  Fold[If[StringMatchQ[#2, RegularExpression["^[$A-Za-z0-9`]+::[A-Za-z0-9]+.*"]] || # === {}, Append[#, #2],
    ReplacePart[#, -1 -> Last[#] <> " " <> #2]] &, {}, lines]];

mathReply[state_String, readAs_String, messages_List, extra_Association : <||>] :=
  Join[<|"state" -> state, "readAs" -> readAs, "rewrites" -> {}, "messages" -> messages|>, extra];

(* TeXForm with each formal symbol shown as its letter. *)
mathTeX[expr_] := Quiet[StringReplace[ToString[TeXForm[expr]],
  (ToString[TeXForm[#[[2]]]] -> SymbolName[#[[1]]]) & /@ mathFormal]];

(* Variables bound by an iterator or a limit inside the parse, which are not free even when the sum or integral stays unevaluated. *)
mathBound[held_Hold] := Union[Flatten[{
  Cases[held, (Sum | Product | Integrate)[_, its__] :> Cases[Hold[its], {v_Symbol, __} :> Hold[v]], {0, Infinity}],
  Cases[held, Limit[_, v_Symbol -> _, ___] :> Hold[v], {0, Infinity}]}]];

(* The Global` and formal symbols left in an evaluated expression (heads such as y in y[x] are not visited), minus the bound ones, sorted by name. *)
mathFree[expr_, held_Hold] := SortBy[
  Complement[Union[Cases[expr, s_Symbol /; Context[Unevaluated[s]] === "Global`" || mathFormalQ[Hold[s]] :> Hold[s], {0, Infinity}]], mathBound[held]],
  Replace[#, Hold[s_] :> mathShowName[s]] &];

(* solve: DSolve for the function under Derivative in its own variable, else Solve over the free symbols; an expression is solved as expr == 0. *)
mathSolve[held_Hold] := Module[{equation = ReleaseHold[held], fn, var},
  If[Head[equation] =!= Equal && ! MatchQ[equation, True | False | _List], equation = equation == 0];
  fn = FirstCase[held, Derivative[__][f_Symbol][___] :> Hold[f], None, {0, Infinity}];
  If[fn =!= None,
    var = FirstCase[held, Derivative[__][f_Symbol][v_Symbol] /; Hold[f] === fn :> Hold[v], None, {0, Infinity}];
    If[var =!= None,
      Return[With[{f = ReleaseHold[fn], v = ReleaseHold[var]}, DSolve[equation, f[v], v]], Module]]
  ];
  Solve[equation, ReleaseHold /@ mathFree[equation, held]]
];

(* A sample coordinate in (0.1, 3) rounded to 4 significant digits, so the point the reply shows is the point that was evaluated. *)
mathSample[x_Real] := N[Round[Rationalize[x, 0], 10^(Floor[Log10[x]] - 3)]];
mathNumber[x_] := ToString[NumberForm[x, 6, ExponentFunction -> (Null &)]];
mathAgree[l_, r_] := Abs[l - r] <= 10^-9 Max[Abs[l], Abs[r]] || Abs[l - r] < 10^-12;
mathFinite[x_] := NumberQ[x] && FreeQ[x, DirectedInfinity | Indeterminate];

(* check: proved when Simplify[lhs - rhs] is 0; else 12 points seeded by the TeX: a point that differs gives differs, all points agreeing give sampled;
   when the points cannot decide (a side is not a finite number), Reduce over the reals gives proved, differs or conditional. *)
mathCheck[Hold[lhs_], Hold[rhs_], held_Hold, tex_String] := Module[{l = lhs, r = rhs, vars, points, decided, outcome, reduced},
  If[TrueQ[Simplify[l - r] === 0], Return[{"proved", <||>}, Module]];
  vars = ReleaseHold /@ mathFree[{l, r}, held];
  points = BlockRandom[SeedRandom[Hash[tex, "CRC32"]]; Map[mathSample, RandomReal[{0.1, 3}, {12, Length[vars]}], {2}]];
  decided = True;
  outcome = Catch[
    Scan[Function[point, With[{rules = Thread[vars -> point]}, With[{lv = N[l /. rules], rv = N[r /. rules]},
      Which[
        ! (mathFinite[lv] && mathFinite[rv]), decided = False,
        ! mathAgree[lv, rv], Throw[{"differs", <|"counterexample" -> <|
          "point" -> AssociationThread[(mathShowName /@ vars), point], "lhs" -> mathNumber[lv], "rhs" -> mathNumber[rv]|>|>}, mathTag]
      ]]]], points];
    None, mathTag];
  Which[
    outcome =!= None, outcome,
    decided, {"sampled", <||>},
    True,
      reduced = Reduce[l == r, vars, Reals];
      Which[
        reduced === True, {"proved", <||>},
        reduced === False, {"differs", <||>},
        Head[reduced] === Reduce, {"failed", <|"note" -> "The step could not be decided"|>},
        True, {"conditional", <|"condition" -> mathTeX[reduced]|>}
      ]
  ]
];

(* The op on the held parse; {state, extra} for check, the value otherwise. *)
mathRun["eval", held_Hold, _] := Simplify[ReleaseHold[held]];
mathRun["numeric", held_Hold, _] := N[ReleaseHold[held]];
mathRun["solve", held_Hold, _] := mathSolve[held];
mathRun["check", held_Hold, tex_] := Replace[held, Hold[lhs_ == rhs_] :> mathCheck[Hold[lhs], Hold[rhs], held, tex]];

mathLimit["check"] = 5;
mathLimit[_] = 10;

(* Answers one math request: {reply, printed}. *)
mathAnswer[request_Association] := Module[{op = Lookup[request, "op", None], tex = Lookup[request, "tex", None],
    held, printed, messages, refused, readAs, result, limit},
  If[! MemberQ[{"eval", "numeric", "solve", "check"}, op] || ! StringQ[tex],
    Return[{mathReply["failed", "", {"Unknown math request"}], ""}, Module]];
  {held, printed, messages} = captured[ToExpression[tex, TeXForm, Hold]];
  messages = mathMessages[messages];
  If[! MatchQ[held, Hold[_]] || MatchQ[held, Hold[$Failed]],
    Return[{mathReply["unread", "", If[messages === {}, {"The TeX could not be read"}, messages]], printed}, Module]];
  held = mathOperators[held];
  readAs = Replace[held, Hold[e_] :> oneLine[HoldForm[e]]];
  held = mathFormalise[held];
  refused = mathRefused[held];
  If[refused =!= None,
    Return[{mathReply["unread", readAs, {"Refused symbol " <> Replace[refused, Hold[s_] :> SymbolName[Unevaluated[s]]]}], printed}, Module]];
  If[op === "check" && ! MatchQ[held, Hold[_ == _]],
    Return[{mathReply["unread", readAs, {"A check needs one equation lhs = rhs"}], printed}, Module]];
  limit = mathLimit[op];
  {result, printed, messages} = captured[TimeConstrained[mathRun[op, held, tex], limit, mathTimedOut]];
  messages = mathMessages[messages];
  Quiet[Which[
    result === mathTimedOut, {mathReply["failed", readAs, Append[messages, "Took longer than " <> ToString[limit] <> " s"]], printed},
    result === $Aborted || result === $Failed, {mathReply["failed", readAs, If[messages === {}, {ToString[result]}, messages]], printed},
    op === "check" && MatchQ[result, {_String, _Association}],
      {mathReply[result[[1]], readAs, Join[messages, If[KeyExistsQ[result[[2]], "note"], {result[[2]]["note"]}, {}]], KeyDrop[result[[2]], "note"]], printed},
    op === "check", {mathReply["failed", readAs, If[messages === {}, {"The step could not be checked"}, messages]], printed},
    True, {mathReply["value", readAs, messages, <|"latex" -> mathTeX[result]|>], printed}
  ]]
];

End[];
