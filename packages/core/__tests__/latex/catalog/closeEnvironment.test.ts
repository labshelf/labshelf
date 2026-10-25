// Tests which environment a typed closing brace of \begin{name} should close.
import { environmentToClose } from "../../../src/latex/catalog/index";

const after = (text: string) => () => text;

describe("environmentToClose", () => {
  it("names the environment when nothing follows", () => {
    expect(environmentToClose("\\begin{itemize}", after(""))).toBe("itemize");
    expect(environmentToClose("  text \\begin{center}", after("\nmore text"))).toBe("center");
  });

  it("keeps the star of starred environments", () => {
    expect(environmentToClose("\\begin{align*}", after(""))).toBe("align*");
    expect(environmentToClose("\\begin{align*}", after("\n\\end{align}"))).toBe("align*");
    expect(environmentToClose("\\begin{align}", after("\n\\end{align*}"))).toBe("align");
  });

  it("returns nothing when an \\end of the same name follows", () => {
    expect(environmentToClose("\\begin{document}", after("\nHello\n\\end{document}\n"))).toBeUndefined();
  });

  it("ignores balanced pairs of the same name that follow", () => {
    const text = "\n\\begin{itemize}\\item a\\end{itemize}\n";
    expect(environmentToClose("\\begin{itemize}", after(text))).toBe("itemize");
  });

  it("returns nothing when a nested pair is followed by the outer \\end", () => {
    const text = "\n\\begin{itemize}\\item a\\end{itemize}\n\\end{itemize}";
    expect(environmentToClose("\\begin{itemize}", after(text))).toBeUndefined();
  });

  it("ignores other environments and commented-out ends", () => {
    expect(environmentToClose("\\begin{itemize}", after("\n\\end{enumerate}"))).toBe("itemize");
    expect(environmentToClose("\\begin{itemize}", after("\n% \\end{itemize}"))).toBe("itemize");
    expect(environmentToClose("\\begin{itemize}", after("\n\\% \\end{itemize}"))).toBeUndefined();
  });

  it("returns nothing when the brace does not close a \\begin", () => {
    expect(environmentToClose("\\textbf{bold}", after(""))).toBeUndefined();
    expect(environmentToClose("\\end{itemize}", after(""))).toBeUndefined();
    expect(environmentToClose("\\begin{}", after(""))).toBeUndefined();
    expect(environmentToClose("% \\begin{itemize}", after(""))).toBeUndefined();
  });

  it("accepts arguments written after the name", () => {
    expect(environmentToClose("\\begin{tabular}{ll}", after(""))).toBe("tabular");
    expect(environmentToClose("  \\begin{figure}[htbp] ", after(""))).toBe("figure");
    expect(environmentToClose("\\begin{tabular}{ll}", after("\n\\end{tabular}"))).toBeUndefined();
    expect(environmentToClose("\\begin{itemize} text", after(""))).toBeUndefined();
  });

  it("reads the text after the cursor only for a \\begin", () => {
    const read = jest.fn(() => "");
    environmentToClose("\\textbf{bold}", read);
    expect(read).not.toHaveBeenCalled();
  });
});
