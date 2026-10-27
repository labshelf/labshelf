// Tests which environment a typed closing brace of \begin{name} should close.
import { findEnvironmentToClose } from "../../../src/latex/catalogCompletion";

const after = (text: string) => () => text;

describe("findEnvironmentToClose", () => {
  it("names the environment when nothing follows", () => {
    expect(findEnvironmentToClose("\\begin{itemize}", after(""))).toBe("itemize");
    expect(findEnvironmentToClose("  text \\begin{center}", after("\nmore text"))).toBe("center");
  });

  it("keeps the star of starred environments", () => {
    expect(findEnvironmentToClose("\\begin{align*}", after(""))).toBe("align*");
    expect(findEnvironmentToClose("\\begin{align*}", after("\n\\end{align}"))).toBe("align*");
    expect(findEnvironmentToClose("\\begin{align}", after("\n\\end{align*}"))).toBe("align");
  });

  it("returns nothing when an \\end of the same name follows", () => {
    expect(findEnvironmentToClose("\\begin{document}", after("\nHello\n\\end{document}\n"))).toBeUndefined();
  });

  it("ignores balanced pairs of the same name that follow", () => {
    const text = "\n\\begin{itemize}\\item a\\end{itemize}\n";
    expect(findEnvironmentToClose("\\begin{itemize}", after(text))).toBe("itemize");
  });

  it("returns nothing when a nested pair is followed by the outer \\end", () => {
    const text = "\n\\begin{itemize}\\item a\\end{itemize}\n\\end{itemize}";
    expect(findEnvironmentToClose("\\begin{itemize}", after(text))).toBeUndefined();
  });

  it("ignores other environments and commented-out ends", () => {
    expect(findEnvironmentToClose("\\begin{itemize}", after("\n\\end{enumerate}"))).toBe("itemize");
    expect(findEnvironmentToClose("\\begin{itemize}", after("\n% \\end{itemize}"))).toBe("itemize");
    expect(findEnvironmentToClose("\\begin{itemize}", after("\n\\% \\end{itemize}"))).toBeUndefined();
  });

  it("returns nothing when the brace does not close a \\begin", () => {
    expect(findEnvironmentToClose("\\textbf{bold}", after(""))).toBeUndefined();
    expect(findEnvironmentToClose("\\end{itemize}", after(""))).toBeUndefined();
    expect(findEnvironmentToClose("\\begin{}", after(""))).toBeUndefined();
    expect(findEnvironmentToClose("% \\begin{itemize}", after(""))).toBeUndefined();
  });

  it("accepts arguments written after the name", () => {
    expect(findEnvironmentToClose("\\begin{tabular}{ll}", after(""))).toBe("tabular");
    expect(findEnvironmentToClose("  \\begin{figure}[htbp] ", after(""))).toBe("figure");
    expect(findEnvironmentToClose("\\begin{tabular}{ll}", after("\n\\end{tabular}"))).toBeUndefined();
    expect(findEnvironmentToClose("\\begin{itemize} text", after(""))).toBeUndefined();
  });

  it("reads the text after the cursor only for a \\begin", () => {
    const read = jest.fn(() => "");
    findEnvironmentToClose("\\textbf{bold}", read);
    expect(read).not.toHaveBeenCalled();
  });
});
