#ifndef WARNSDORFF_DFS_C_H
#define WARNSDORFF_DFS_C_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void dfs_configure(int width, int height);
void dfs_set_cancel_flag(volatile int *flag);
void dfs_set_cancelled(int cancelled);

/* rem_words: DFS_MASK_WORDS (8) uint64 little-endian limbs (bit 0 = cell 0).
 * required_end: -1 = none.
 * Returns 1 on success, 0 on fail/cancel. */
int warnsdorff_dfs_run(
    int head,
    const uint64_t *rem_words,
    int nleft,
    int black,
    int required_end,
    int node_limit,
    int want_path,
    int use_memo,
    int *path_out,
    int path_cap,
    int *path_len_out,
    int *nodes_out
);

#ifdef __cplusplus
}
#endif

#endif
