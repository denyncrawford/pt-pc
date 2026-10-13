#pragma once
#include <glm/glm.hpp>
#include <span>
#include <cmath>

namespace pt::game {
// Shared with the browser bridge: FOX traps query the controller sphere centre,
// using half-unit extents in each transformed BoxShape (not an eye-position test).
inline bool PointInTrap(std::span<const glm::mat4> boxes, const glm::mat4& placement, const glm::vec3& point) {
    for (const auto& box : boxes) {
        const glm::mat4 world = placement * box;
        if (std::abs(glm::determinant(world)) < 1.0e-12f) continue;
        const glm::vec3 local(glm::inverse(world) * glm::vec4(point, 1.0f));
        if (glm::all(glm::lessThanEqual(glm::abs(local), glm::vec3(0.5f)))) return true;
    }
    return false;
}
}
