"""Fits and plots a growth curve."""
import numpy as np
from functools import cache


@cache
def fit_model(x, y):
    """Fits a straight line to the data.

    def not_a_function(): this docstring must not create a symbol.
    """
    slope, intercept = np.polyfit(x, y, 1)
    return slope, intercept


class GrowthModel:
    """A logistic growth model."""

    def __init__(self, rate, capacity):
        self.rate = rate
        self.capacity = capacity

    def predict(self, t, n0=1.0):
        k, r = self.capacity, self.rate
        return k / (1 + (k - n0) / n0 * np.exp(-r * t))

    async def fetch(self, url):
        return url


def residuals(model, t, observed):
    return observed - model.predict(t)


if __name__ == "__main__":
    print(fit_model(np.arange(5), np.arange(5) * 2.0))
