// Tests the citation card shape of a .bib record.
import { bibCardEntry, bibEntries } from "../../../src/index.js";

describe("bibCardEntry", () => {
  it("reads title, authors, year and the first venue field as plain text", () => {
    const [entry] = bibEntries("@article{k, title={A {Deep} Study}, author={Ada Lovelace and Alan Turing}, date={2021-05-01}, journaltitle={Nature}}");
    expect(bibCardEntry(entry!)).toEqual({ authors: ["Ada Lovelace", "Alan Turing"], title: "A Deep Study", year: 2021, venue: "Nature" });
  });

  it("leaves out the fields a record lacks", () => {
    const [entry] = bibEntries("@misc{k, title={Only}}");
    expect(bibCardEntry(entry!)).toEqual({ authors: [], title: "Only" });
  });
});
