module Simulate

struct Particle
    x::Float64
    v::Float64
end

function step!(p::Particle, dt)
    last = [p.x, p.v][end]
    for i in 1:3
        println([j for j in 1:i])
    end
    p.x += p.v * dt
    return last
end

energy(p::Particle) = 0.5 * p.v^2

end
