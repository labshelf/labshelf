% Plots the fitted curve (no symbols: links by lines or whole file).
t = linspace(0, 10, 100);
y = 1 ./ (1 + exp(-t));
plot(t, y);
