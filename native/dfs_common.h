/* Shared DFS bitmask helpers — up to 504 cells (8 × uint64 = 512 bits). */
#ifndef DFS_COMMON_H
#define DFS_COMMON_H

#include <stdint.h>
#include <string.h>

#if defined(_MSC_VER)
#include <intrin.h>
#endif

#define DFS_N_MAX 504
#define DFS_MASK_WORDS 8

typedef struct {
    uint64_t w[DFS_MASK_WORDS];
} DfsMask;

static inline DfsMask dfs_mask_zero(void) {
    DfsMask m;
    memset(&m, 0, sizeof(m));
    return m;
}

static inline int dfs_bit_test(DfsMask m, int i) {
    return (int)((m.w[i >> 6] >> (i & 63)) & 1ULL);
}

static inline DfsMask dfs_bit_set(DfsMask m, int i) {
    m.w[i >> 6] |= 1ULL << (i & 63);
    return m;
}

static inline DfsMask dfs_bit_clear(DfsMask m, int i) {
    m.w[i >> 6] &= ~(1ULL << (i & 63));
    return m;
}

static inline DfsMask dfs_mask_and(DfsMask a, DfsMask b) {
    DfsMask m;
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++)
        m.w[i] = a.w[i] & b.w[i];
    return m;
}

static inline DfsMask dfs_mask_not_and(DfsMask a, DfsMask b) {
    DfsMask m;
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++)
        m.w[i] = a.w[i] & ~b.w[i];
    return m;
}

static inline int dfs_mask_eq(DfsMask a, DfsMask b) {
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++) {
        if (a.w[i] != b.w[i])
            return 0;
    }
    return 1;
}

static inline int dfs_mask_empty(DfsMask m) {
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++) {
        if (m.w[i])
            return 0;
    }
    return 1;
}

static inline int dfs_ctz64(uint64_t x) {
#if defined(_MSC_VER)
    unsigned long idx;
    _BitScanForward64(&idx, x);
    return (int)idx;
#else
    return __builtin_ctzll(x);
#endif
}

static inline int dfs_popcount64(uint64_t x) {
#if defined(_MSC_VER)
    return (int)__popcnt64(x);
#else
    return __builtin_popcountll(x);
#endif
}

static inline int dfs_mask_popcount(DfsMask m) {
    int n = 0, i;
    for (i = 0; i < DFS_MASK_WORDS; i++)
        n += dfs_popcount64(m.w[i]);
    return n;
}

static inline int dfs_mask_lowest(DfsMask m) {
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++) {
        if (m.w[i])
            return (i << 6) + dfs_ctz64(m.w[i]);
    }
    return -1;
}

static inline DfsMask dfs_mask_clear_lowest(DfsMask m) {
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++) {
        if (m.w[i]) {
            m.w[i] &= m.w[i] - 1;
            return m;
        }
    }
    return m;
}

static inline void dfs_mask_from_words(DfsMask *out, const uint64_t *words) {
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++)
        out->w[i] = words ? words[i] : 0;
}

static inline void dfs_mask_to_words(DfsMask m, uint64_t *words) {
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++)
        words[i] = m.w[i];
}

#endif /* DFS_COMMON_H */
