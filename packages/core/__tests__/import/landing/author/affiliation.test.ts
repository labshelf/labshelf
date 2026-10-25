import { extractEmailFromAffiliation } from "@labshelf/core";

describe("emailFromAffiliation", () => {
  it("reads the address after 'Electronic address:' and drops the trailing period", () => {
    expect(extractEmailFromAffiliation("Department of Surgery, Mayo Clinic, Rochester, MN, USA. Electronic address: jane.doe@mayo.example.edu.")).toBe("jane.doe@mayo.example.edu");
  });

  it("finds the address among several affiliations", () => {
    const text = "Institute of Pathology, Charite, Berlin, Germany. Department of Oncology, Oxford, UK. Electronic address: k.mueller@charite.example.de. Genome Centre, Tokyo, Japan.";
    expect(extractEmailFromAffiliation(text)).toBe("k.mueller@charite.example.de");
  });

  it("stops at a semicolon", () => {
    expect(extractEmailFromAffiliation("Lab A. Electronic address: a@b.example.org; Lab B.")).toBe("a@b.example.org");
  });

  it("returns undefined when no affiliation has an address", () => {
    expect(extractEmailFromAffiliation("Department of Physics, MIT, Cambridge, MA, USA.")).toBeUndefined();
  });

  it("returns undefined for a malformed address", () => {
    expect(extractEmailFromAffiliation("Lab. Electronic address: nobody.")).toBeUndefined();
  });
});
