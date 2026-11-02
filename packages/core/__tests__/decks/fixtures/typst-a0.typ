// labshelf: poster
#set page(width: 841mm, height: 1189mm, margin: 3cm)
#set text(size: 32pt)
#show heading.where(level: 1): it => block(below: 0.6em, text(size: 54pt, fill: rgb("#1f5673"), it.body))

#align(center)[
  #text(size: 96pt, weight: "bold")[Pôster Typst A0]
]
#v(2cm)

#columns(2, gutter: 3cm)[
  = Introduction
  What the problem is and why it matters.

  = Method
  $ min_x norm(A x - b)_2^2 $

  #colbreak()

  = Results
  A figure goes here.

  = Conclusion
  The main take-away in one sentence.
]
