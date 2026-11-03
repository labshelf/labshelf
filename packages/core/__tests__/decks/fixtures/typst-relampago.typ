// labshelf: talk
// One slide per level-2 heading (== Title). Speaker notes go in #speaker-note[...]: the presenter view shows them.
#let speaker-note(body) = none

#set page(width: 254mm, height: 142.88mm, margin: (x: 1.6cm, y: 1.2cm), numbering: "1", number-align: right + bottom)
#set text(size: 20pt)
#show heading.where(level: 2): it => {
  pagebreak(weak: true)
  block(below: 1em, text(size: 28pt, weight: "bold", it.body))
}

#align(center + horizon)[
  #text(size: 36pt, weight: "bold")[Grafos em Typst]

  #datetime.today().display()
]
#speaker-note[Greet the audience and say the problem in one sentence.]

== Motivation
- First point
- Second point
#speaker-note[Speaker notes for this slide: only you see them in the presenter view.]

== Results
#grid(columns: (1fr, 1fr), gutter: 1cm,
  [A figure goes here.],
  [$ e^(i pi) + 1 = 0 $],
)

== Conclusion
Thank you!
