library(stats)

# Bootstraps the mean with a brace in a string: "}"
bootstrap_mean <- function(x, n = 1000, label = "}") {
  # a brace in a comment }
  means <- replicate(n, mean(sample(x, replace = TRUE)))
  quantile(means, c(0.025, 0.975))
}

square <- \(x) x^2

summarise_groups = function(df, group) {
  aggregate(value ~ get(group), data = df, FUN = mean)
}
