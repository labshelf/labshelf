#import "@preview/peace-of-posters:0.5.0" as pop
#set page("a0", margin: 1cm)
#pop.set-poster-layout(pop.layout-a0)
#pop.set-theme(pop.uni-fr)
#set text(size: pop.layout-a0.at("body-size"))

#pop.title-box(
  "Poster title",
  authors: "A. Author",
)

#columns(2)[
  #pop.column-box(heading: "Introduction")[
    What the problem is and why it matters.
  ]
]
