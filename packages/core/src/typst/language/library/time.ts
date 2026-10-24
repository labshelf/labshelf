// Catalogues Typst's datetime and duration types with their methods.
import { fn, named, pos, ty, type TypstBuiltin } from "./typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => fn(name, doc, [], returns);
const part = (name: string) => named(name, "int", undefined, `The ${name}.`);
const span = (name: string) => named(name, "int", "0", `The number of ${name}.`);

export const TIME: readonly TypstBuiltin[] = [
  ty("datetime", "A date, a time, or both; give either the full date, the full time, or all six parts.", [
    part("year"), part("month"), part("day"), part("hour"), part("minute"), part("second"),
  ], [
    fn("display", "Formats the datetime as a string.", [
      pos("pattern", "auto | str", "The format, such as `\"[year]-[month]-[day]\"`; `auto` picks one by the parts present.", "auto"),
    ], "str"),
    method("year", "The year, or `none` for a time.", "none | int"),
    method("month", "The month, or `none` for a time.", "none | int"),
    method("weekday", "The weekday, from 1 (Monday) to 7, or `none` for a time.", "none | int"),
    method("day", "The day of the month, or `none` for a time.", "none | int"),
    method("hour", "The hour, or `none` for a date.", "none | int"),
    method("minute", "The minute, or `none` for a date.", "none | int"),
    method("second", "The second, or `none` for a date.", "none | int"),
    method("ordinal", "The day of the year, or `none` for a time.", "none | int"),
    fn("today", "The current date, called as `datetime.today()`.", [
      named("offset", "auto | int", "auto", "The UTC offset in hours; `auto` uses the local time zone."),
    ], "datetime"),
  ]),
  ty("duration", "A span of time, which results from subtracting two datetimes.", [
    span("seconds"), span("minutes"), span("hours"), span("days"), span("weeks"),
  ], [
    method("seconds", "The duration in seconds.", "float"),
    method("minutes", "The duration in minutes.", "float"),
    method("hours", "The duration in hours.", "float"),
    method("days", "The duration in days.", "float"),
    method("weeks", "The duration in weeks.", "float"),
  ]),
];
