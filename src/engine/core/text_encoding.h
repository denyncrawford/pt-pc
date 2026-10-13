#pragma once
#include <cstdint>
#include <string>
#include <string_view>

// Original subtitle encodings: retain UTF-8, otherwise interpret Windows-1252.
namespace pt::text {
inline constexpr uint16_t kCp1252[32] = {0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
                                  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178};

inline bool ValidUtf8(std::string_view text) {
    for (size_t i = 0; i < text.size();) {
        const uint8_t c = static_cast<uint8_t>(text[i]);
        const size_t extra = c < 0x80 ? 0 : (c & 0xE0) == 0xC0 ? 1 : (c & 0xF0) == 0xE0 ? 2 : (c & 0xF8) == 0xF0 ? 3 : 4;
        if (extra == 4 || (extra > 0 && i + extra >= text.size())) {
            return false;
        }
        for (size_t k = 1; k <= extra; ++k) {
            if ((static_cast<uint8_t>(text[i + k]) & 0xC0) != 0x80) {
                return false;
            }
        }
        i += extra + 1;
    }
    return true;
}

inline std::string Cp1252ToUtf8(std::string_view text) {
    std::string out;
    for (const char ch : text) {
        const uint8_t c = static_cast<uint8_t>(ch);
        const uint32_t code = c >= 0x80 && c < 0xA0 ? kCp1252[c - 0x80] : c;
        if (code < 0x80) {
            out.push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (code >> 6)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xE0 | (code >> 12)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        }
    }
    return out;
}

}
