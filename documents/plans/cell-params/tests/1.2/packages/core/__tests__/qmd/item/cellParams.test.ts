import {
  formatCellParamLine,
  formatOutputParams,
  paramValues,
  parseCellParams,
  readOutputParams,
  setCellParamValue,
  type CellParam,
} from "../../../src/qmd/item/cellParams";

const lines = (...rows: string[]) => rows.map((row) => `${row}\n`).join("");

describe("parseCellParams", () => {
  it("1.2a parses a slider line with min, max and value", () => {
    expect(parseCellParams("#| param: x = slider(0, 10, 5)\n")).toEqual([{ name: "x", kind: "slider", min: 0, max: 10, value: 5 }]);
  });

  it("1.2a parses a slider with step, log, negative and decimal numbers", () => {
    expect(parseCellParams("#| param: gain = slider(-1.5, 2.5, 0.25, step = 0.05, log)\n")).toEqual([
      { name: "gain", kind: "slider", min: -1.5, max: 2.5, value: 0.25, step: 0.05, log: true },
    ]);
  });

  it("1.2a parses a slider with step and no log", () => {
    const [param] = parseCellParams("#| param: x = slider(0, 10, 5, step = 2)\n");
    expect(param).toMatchObject({ kind: "slider", step: 2 });
    expect((param as { log?: boolean }).log).toBeFalsy();
  });

  it("1.2a parses a select of numbers with its value after the semicolon", () => {
    expect(parseCellParams("#| param: n = select(1, 2, 3; 2)\n")).toEqual([{ name: "n", kind: "select", choices: [1, 2, 3], value: 2 }]);
  });

  it("1.2a parses a select of double-quoted strings with escaped quotes", () => {
    expect(parseCellParams('#| param: m = select("a", "b\\"c"; "b\\"c")\n')).toEqual([
      { name: "m", kind: "select", choices: ["a", 'b"c'], value: 'b"c' },
    ]);
  });

  it("1.2a parses a checkbox with true and false", () => {
    expect(parseCellParams(lines("#| param: on = checkbox(true)", "#| param: off = checkbox(false)"))).toEqual([
      { name: "on", kind: "checkbox", value: true },
      { name: "off", kind: "checkbox", value: false },
    ]);
  });

  it("1.2a tolerates free spaces around tokens", () => {
    expect(parseCellParams("#| param:   a   =  slider( 0 , 10 , 5 , step=0.5 , log )\n")).toEqual([
      { name: "a", kind: "slider", min: 0, max: 10, value: 5, step: 0.5, log: true },
    ]);
    expect(parseCellParams("#| param: b=select( 1 ,2 ;1 )\n")).toEqual([{ name: "b", kind: "select", choices: [1, 2], value: 1 }]);
    expect(parseCellParams("#| param: c = checkbox( true )\n")).toEqual([{ name: "c", kind: "checkbox", value: true }]);
  });

  it("1.2a keeps declaration order and skips #| lines that are not params", () => {
    const options = lines("#| label: fig", "#| param: z = checkbox(true)", "#| echo: false", "#| param: a = checkbox(false)");
    expect(parseCellParams(options).map((param) => param.name)).toEqual(["z", "a"]);
  });

  it("1.2a reads CRLF options", () => {
    expect(parseCellParams("#| param: x = slider(0, 10, 5)\r\n#| param: on = checkbox(true)\r\n").map((param) => param.name)).toEqual(["x", "on"]);
  });

  it("1.2a ignores malformed lines and keeps the valid ones", () => {
    const options = lines(
      "#| param: a = slider(0, 10",
      "#| param: b = slider(0, 10)",
      "#| param: c = slider(0, 10, abc)",
      "#| param: d = knob(1)",
      "#| param: e = checkbox(maybe)",
      "#| param: f = select(1, 2)",
      "#| param: g = ",
      "#| param: ok = checkbox(true)",
    );
    expect(parseCellParams(options)).toEqual([{ name: "ok", kind: "checkbox", value: true }]);
  });

  it("1.2a ignores a bad name", () => {
    const options = lines(
      "#| param: 1x = checkbox(true)",
      "#| param: _x = checkbox(true)",
      "#| param: a-b = checkbox(true)",
      "#| param: a b = checkbox(true)",
      "#| param: good_1 = checkbox(true)",
    );
    expect(parseCellParams(options).map((param) => param.name)).toEqual(["good_1"]);
  });

  it("1.2a reads at most 8 params and ignores the 9th", () => {
    const options = lines(...Array.from({ length: 9 }, (_, i) => `#| param: p${i + 1} = checkbox(true)`));
    expect(parseCellParams(options).map((param) => param.name)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
  });

  it("1.2a returns no params for options without param lines", () => {
    expect(parseCellParams("")).toEqual([]);
    expect(parseCellParams("#| label: fig\n")).toEqual([]);
  });

  it("1.2a clamps a slider value outside [min, max] when read", () => {
    expect(parseCellParams("#| param: hi = slider(0, 10, 15)\n")[0]).toMatchObject({ value: 10 });
    expect(parseCellParams("#| param: lo = slider(0, 10, -3)\n")[0]).toMatchObject({ value: 0 });
  });

  it("1.2a does not rewrite an out-of-range value when only reading", () => {
    const options = "#| param: hi = slider(0, 10, 15)\n";
    parseCellParams(options);
    expect(setCellParamValue(options, "hi", 15)).toBe(options);
  });
});

describe("setCellParamValue", () => {
  it("1.2b rewrites only the value of a slider line", () => {
    expect(setCellParamValue("#| param: x = slider(0, 10, 5)\n", "x", 7)).toBe("#| param: x = slider(0, 10, 7)\n");
  });

  it("1.2b keeps the spacing of the line byte for byte", () => {
    expect(setCellParamValue("#| param:   a   =  slider( 0 , 10 , 5 , step=0.5 , log )\n", "a", 6.5)).toBe(
      "#| param:   a   =  slider( 0 , 10 , 6.5 , step=0.5 , log )\n",
    );
  });

  it("1.2b rewrites the value, not an equal min or choice", () => {
    expect(setCellParamValue("#| param: x = slider(5, 10, 5)\n", "x", 7)).toBe("#| param: x = slider(5, 10, 7)\n");
    expect(setCellParamValue("#| param: n = select(1, 2; 1)\n", "n", 2)).toBe("#| param: n = select(1, 2; 2)\n");
  });

  it("1.2b leaves step and log alone when the value of a slider changes", () => {
    expect(setCellParamValue("#| param: x = slider(0, 10, 5, step = 0.5, log)\n", "x", 6)).toBe("#| param: x = slider(0, 10, 6, step = 0.5, log)\n");
  });

  it("1.2b rewrites a select value as a number or a double-quoted string", () => {
    expect(setCellParamValue("#| param: n = select(1, 2, 3; 2)\n", "n", 3)).toBe("#| param: n = select(1, 2, 3; 3)\n");
    expect(setCellParamValue('#| param: m = select("a", "b"; "a")\n', "m", "b")).toBe('#| param: m = select("a", "b"; "b")\n');
    expect(setCellParamValue('#| param: m = select("a", "b\\"c"; "a")\n', "m", 'b"c')).toBe('#| param: m = select("a", "b\\"c"; "b\\"c")\n');
  });

  it("1.2b rewrites a checkbox value", () => {
    expect(setCellParamValue("#| param: on = checkbox(false)\n", "on", true)).toBe("#| param: on = checkbox(true)\n");
    expect(setCellParamValue("#| param: on = checkbox( true )\n", "on", false)).toBe("#| param: on = checkbox( false )\n");
  });

  it("1.2b keeps CRLF line endings", () => {
    const options = "#| label: fig\r\n#| param: x = slider(0, 10, 5)\r\n#| param: on = checkbox(true)\r\n";
    expect(setCellParamValue(options, "x", 9)).toBe("#| label: fig\r\n#| param: x = slider(0, 10, 9)\r\n#| param: on = checkbox(true)\r\n");
  });

  it("1.2b keeps mixed line endings of the other lines as written", () => {
    const options = "#| param: a = checkbox(true)\r\n#| param: b = checkbox(true)\n#| param: c = checkbox(true)\r\n";
    expect(setCellParamValue(options, "b", false)).toBe("#| param: a = checkbox(true)\r\n#| param: b = checkbox(false)\n#| param: c = checkbox(true)\r\n");
  });

  it("1.2b changes only the named param and leaves other lines untouched", () => {
    const options = lines("#| label: fig", "#| echo: false", "#| param: a = slider(0, 1, 0.5)", "#| param: b = slider(0, 1, 0.5)");
    expect(setCellParamValue(options, "b", 1)).toBe(lines("#| label: fig", "#| echo: false", "#| param: a = slider(0, 1, 0.5)", "#| param: b = slider(0, 1, 1)"));
  });

  it("1.2b returns the options unchanged for an unknown name", () => {
    const options = "#| param: x = slider(0, 10, 5)\n";
    expect(setCellParamValue(options, "nope", 3)).toBe(options);
  });

  it("1.2b returns the options unchanged when the named line is malformed", () => {
    const options = "#| param: x = slider(0, 10\n#| param: 1y = checkbox(true)\n";
    expect(setCellParamValue(options, "x", 3)).toBe(options);
    expect(setCellParamValue(options, "1y", false)).toBe(options);
  });

  it("A1 rewriting a param with its own value changes no byte", () => {
    const options = lines(
      "#| label: fig",
      "#|   param: skip = nothing",
      "#| param:  a  =  slider( 0 , 10 , 5 , step = 0.5 , log )",
      '#| param: b = select("x", "y\\"z"; "y\\"z")',
      "#| param: c = checkbox( false )",
    ).replace(/\n/g, "\r\n");
    for (const param of parseCellParams(options)) {
      expect(setCellParamValue(options, param.name, param.value)).toBe(options);
    }
  });

  it("A1 a rewritten value parses back with the other parts of the param unchanged", () => {
    const options = "#| param: a = slider(0, 10, 5, step = 0.5, log)\n";
    const next = setCellParamValue(options, "a", 8);
    expect(parseCellParams(next)).toEqual([{ name: "a", kind: "slider", min: 0, max: 10, value: 8, step: 0.5, log: true }]);
  });
});

describe("formatCellParamLine", () => {
  const params: CellParam[] = [
    { name: "x", kind: "slider", min: 0, max: 10, value: 5 },
    { name: "g", kind: "slider", min: -1.5, max: 2.5, value: 0.25, step: 0.05, log: true },
    { name: "n", kind: "select", choices: [1, 2, 3], value: 2 },
    { name: "m", kind: "select", choices: ["a", 'b"c'], value: 'b"c' },
    { name: "on", kind: "checkbox", value: true },
    { name: "off", kind: "checkbox", value: false },
  ];

  it("A1 formats a line that parses back to the same param", () => {
    for (const param of params) {
      expect(parseCellParams(`${formatCellParamLine(param)}\n`)).toEqual([param]);
    }
  });

  it("A1 formats a #| param line named after the param", () => {
    for (const param of params) {
      expect(formatCellParamLine(param)).toMatch(new RegExp(`^#\\| param: ${param.name} = ${param.kind}\\(`));
    }
  });

  it("A1 formats a line without a line ending that survives a value rewrite", () => {
    const line = formatCellParamLine(params[0]!);
    expect(line).not.toMatch(/[\r\n]/);
    expect(setCellParamValue(`${line}\n`, "x", 6)).toBe(`${formatCellParamLine({ ...params[0]!, value: 6 } as CellParam)}\n`);
  });
});

describe("paramValues", () => {
  it("1.2c maps each param name to its value", () => {
    const options = lines("#| param: a = slider(0, 10, 5)", '#| param: b = select("x", "y"; "y")', "#| param: c = checkbox(true)");
    expect(paramValues(parseCellParams(options))).toEqual({ a: 5, b: "y", c: true });
  });

  it("1.2c reports the clamped value of an out-of-range slider", () => {
    expect(paramValues(parseCellParams("#| param: a = slider(0, 10, 15)\n"))).toEqual({ a: 10 });
  });

  it("1.2c is empty for no params", () => {
    expect(paramValues([])).toEqual({});
  });
});

describe("formatOutputParams and readOutputParams", () => {
  it("1.2c joins name=value pairs sorted by name with semicolons", () => {
    expect(formatOutputParams({ zeta: 2, alpha: true, mid: 1 })).toBe("alpha=true;mid=1;zeta=2");
  });

  it("1.2c writes numbers in shortest round-trip form and booleans as true or false", () => {
    expect(formatOutputParams({ a: 0.9, b: false })).toBe("a=0.9;b=false");
    expect(formatOutputParams({ a: 1 })).toBe("a=1");
    expect(formatOutputParams({ a: -2.5 })).toBe("a=-2.5");
    expect(formatOutputParams({ a: 0.1 + 0.2 })).toBe("a=0.30000000000000004");
  });

  it("1.2c writes a string JSON-quoted", () => {
    const attr = formatOutputParams({ label: "a" });
    expect(attr.startsWith("label=")).toBe(true);
    expect(attr).toContain('"');
    expect(attr).not.toContain("=a");
  });

  it("1.2c reads back what it wrote, for numbers, strings and booleans", () => {
    const values = { beta: 0.9, label: "a", log: true, off: false, n: -3, tiny: 1e-7, sum: 0.1 + 0.2 };
    expect(readOutputParams(formatOutputParams(values))).toEqual(values);
  });

  it("1.2c reads back strings that look like other values or hold separators and quotes", () => {
    const values = { a: "true", b: "1", c: "x;y=z", d: 'q"uote', e: "back\\slash", f: "" };
    expect(readOutputParams(formatOutputParams(values))).toEqual(values);
  });

  it("1.2c reads the example attribute from the contract", () => {
    expect(readOutputParams('beta=0.9;label="a";log=true')).toEqual({ beta: 0.9, label: "a", log: true });
  });

  it("1.2c returns undefined for an attribute that is not a params list", () => {
    expect(readOutputParams("garbage")).toBeUndefined();
  });

  it("1.2c an output written with the cell's param values reads back equal to them", () => {
    const options = lines("#| label: fig", "#| param: z = checkbox(true)", "#| param: a = slider(0, 10, 5)", '#| param: m = select("p", "q"; "q")');
    const values = paramValues(parseCellParams(options));
    expect(readOutputParams(formatOutputParams(values))).toEqual(values);
    expect(formatOutputParams(values)).toMatch(/^a=5;m=/);
  });

  it("1.2c a different param value gives a different attribute, the same values the same attribute", () => {
    const options = lines("#| param: a = slider(0, 10, 5)", "#| param: on = checkbox(true)");
    const written = formatOutputParams(paramValues(parseCellParams(options)));
    expect(formatOutputParams(paramValues(parseCellParams(options)))).toBe(written);
    const moved = setCellParamValue(options, "a", 6);
    expect(formatOutputParams(paramValues(parseCellParams(moved)))).not.toBe(written);
    const toggled = setCellParamValue(options, "on", false);
    expect(formatOutputParams(paramValues(parseCellParams(toggled)))).not.toBe(written);
  });

  it("1.2c declaration order does not change the attribute", () => {
    const one = lines("#| param: a = checkbox(true)", "#| param: b = checkbox(false)");
    const two = lines("#| param: b = checkbox(false)", "#| param: a = checkbox(true)");
    expect(formatOutputParams(paramValues(parseCellParams(one)))).toBe(formatOutputParams(paramValues(parseCellParams(two))));
  });
});
