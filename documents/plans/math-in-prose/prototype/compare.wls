(* Throwaway: for each item in raw.json, is the held parse of readAs the same expression as the held expected reading? *)
items = Import[$ScriptCommandLine[[2]], "RawJSON"];
Do[
  r = Lookup[it["result"], "readAs", ""];
  same = If[r === "", False, Quiet[ToExpression[it["expect"], InputForm, HoldForm] === ToExpression[r, InputForm, HoldForm]]];
  Print[it["id"], "\t", same],
  {it, items}];
