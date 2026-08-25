/* Warnsdorff DFS kernel — mirrors hampath warnsdorffDfs (WASM / native). */
#include "dfs_common.h"
#include "warnsdorff_dfs_c.h"
#include <stdlib.h>
#include <string.h>

static int g_width = 10;
static int g_height = 9;
static int g_n = 90;
static int g_nbr_count[DFS_N_MAX];
static int g_nbrs[DFS_N_MAX][4];
static DfsMask g_nbr_mask[DFS_N_MAX];
static int g_tables_ready = 0;

static volatile int *g_cancel_flag = NULL;
static int g_cancel_storage = 0;

static inline int dfs_color_of(int i) {
    int r = i / g_width;
    int c = i % g_width;
    return (r + c) & 1;
}

static inline int dfs_cancelled(void) {
    return g_cancel_flag && *g_cancel_flag;
}

void dfs_set_cancel_flag(volatile int *flag) {
    g_cancel_flag = flag ? flag : &g_cancel_storage;
    if (!flag)
        g_cancel_storage = 0;
}

void dfs_set_cancelled(int cancelled) {
    if (!g_cancel_flag)
        g_cancel_flag = &g_cancel_storage;
    *g_cancel_flag = cancelled ? 1 : 0;
}

void dfs_configure(int width, int height) {
    int i, r, c, n;
    if (width <= 0 || height <= 0 || width * height > DFS_N_MAX)
        return;
    g_width = width;
    g_height = height;
    g_n = width * height;
    for (i = 0; i < g_n; i++) {
        r = i / g_width;
        c = i % g_width;
        n = 0;
        g_nbr_mask[i] = dfs_mask_zero();
        if (r > 0) {
            g_nbrs[i][n++] = i - g_width;
            g_nbr_mask[i] = dfs_bit_set(g_nbr_mask[i], i - g_width);
        }
        if (r + 1 < g_height) {
            g_nbrs[i][n++] = i + g_width;
            g_nbr_mask[i] = dfs_bit_set(g_nbr_mask[i], i + g_width);
        }
        if (c > 0) {
            g_nbrs[i][n++] = i - 1;
            g_nbr_mask[i] = dfs_bit_set(g_nbr_mask[i], i - 1);
        }
        if (c + 1 < g_width) {
            g_nbrs[i][n++] = i + 1;
            g_nbr_mask[i] = dfs_bit_set(g_nbr_mask[i], i + 1);
        }
        g_nbr_count[i] = n;
        while (n < 4)
            g_nbrs[i][n++] = -1;
    }
    g_tables_ready = 1;
}

static inline int dfs_degree(int i, DfsMask rem) {
    return dfs_mask_popcount(dfs_mask_and(g_nbr_mask[i], rem));
}

static DfsMask dfs_reachable_mask(int start, DfsMask rem) {
    DfsMask seen = dfs_mask_zero();
    int stack[DFS_N_MAX];
    int sp = 0;
    if (!dfs_bit_test(rem, start))
        return seen;
    stack[sp++] = start;
    while (sp) {
        int i = stack[--sp];
        if (dfs_bit_test(seen, i))
            continue;
        seen = dfs_bit_set(seen, i);
        {
            DfsMask rest = dfs_mask_not_and(dfs_mask_and(g_nbr_mask[i], rem), seen);
            while (!dfs_mask_empty(rest)) {
                int b = dfs_mask_lowest(rest);
                stack[sp++] = b;
                rest = dfs_mask_clear_lowest(rest);
            }
        }
    }
    return seen;
}

/* ---- failure memo (open addressing) ---- */
typedef struct {
    uint64_t rem_w[DFS_MASK_WORDS];
    int16_t head;
    int16_t required_end; /* -1 = None */
    uint8_t used;
} MemoSlot;

typedef struct {
    MemoSlot *slots;
    size_t cap;
    size_t count;
} MemoTable;

static uint64_t memo_hash(int head, DfsMask rem, int required_end) {
    uint64_t h = (uint64_t)(uint32_t)head * 0x9E3779B97F4A7C15ULL;
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++) {
        h ^= rem.w[i] + 0xC2B2AE3D27D4EB4FULL + (uint64_t)i * 0x165667B19E3779F9ULL;
        h *= 0x165667B19E3779F9ULL;
    }
    h ^= (uint64_t)(uint32_t)(required_end + 1) * 0x27D4EB2F165667C5ULL;
    return h;
}

static int memo_rem_eq(const MemoSlot *s, DfsMask rem) {
    int i;
    for (i = 0; i < DFS_MASK_WORDS; i++) {
        if (s->rem_w[i] != rem.w[i])
            return 0;
    }
    return 1;
}

static int memo_lookup(MemoTable *t, int head, DfsMask rem, int required_end) {
    size_t i, start;
    if (!t || !t->slots || t->cap == 0)
        return 0;
    start = (size_t)(memo_hash(head, rem, required_end) & (t->cap - 1));
    i = start;
    do {
        MemoSlot *s = &t->slots[i];
        if (!s->used)
            return 0;
        if (s->head == head && s->required_end == required_end && memo_rem_eq(s, rem))
            return 1;
        i = (i + 1) & (t->cap - 1);
    } while (i != start);
    return 0;
}

static int memo_grow(MemoTable *t);

static void memo_insert(MemoTable *t, int head, DfsMask rem, int required_end) {
    size_t i;
    int k;
    if (!t)
        return;
    if (t->cap == 0) {
        t->cap = 1024;
        t->slots = (MemoSlot *)calloc(t->cap, sizeof(MemoSlot));
        t->count = 0;
        if (!t->slots)
            return;
    }
    if (t->count * 2 >= t->cap) {
        if (!memo_grow(t))
            return;
    }
    i = (size_t)(memo_hash(head, rem, required_end) & (t->cap - 1));
    for (;;) {
        MemoSlot *s = &t->slots[i];
        if (!s->used) {
            s->used = 1;
            s->head = (int16_t)head;
            s->required_end = (int16_t)required_end;
            for (k = 0; k < DFS_MASK_WORDS; k++)
                s->rem_w[k] = rem.w[k];
            t->count++;
            return;
        }
        if (s->head == head && s->required_end == required_end && memo_rem_eq(s, rem))
            return;
        i = (i + 1) & (t->cap - 1);
    }
}

static int memo_grow(MemoTable *t) {
    MemoSlot *old = t->slots;
    size_t old_cap = t->cap;
    size_t i;
    t->cap *= 2;
    t->slots = (MemoSlot *)calloc(t->cap, sizeof(MemoSlot));
    if (!t->slots) {
        t->slots = old;
        t->cap = old_cap;
        return 0;
    }
    t->count = 0;
    for (i = 0; i < old_cap; i++) {
        if (old[i].used) {
            DfsMask rem;
            dfs_mask_from_words(&rem, old[i].rem_w);
            memo_insert(t, old[i].head, rem, old[i].required_end);
        }
    }
    free(old);
    return 1;
}

static void memo_free(MemoTable *t) {
    if (t && t->slots) {
        free(t->slots);
        t->slots = NULL;
        t->cap = 0;
        t->count = 0;
    }
}

typedef struct {
    int *path;
    int path_len;
    int path_cap;
    int *nodes;
    int node_limit;
    MemoTable *memo;
    int use_memo;
} DfsCtx;

static int dfs_fail(DfsCtx *ctx, int added) {
    if (ctx->path && added > 0)
        ctx->path_len -= added;
    return 0;
}

static int warnsdorff_dfs_inner(
    int head,
    DfsMask rem,
    int nleft,
    int black,
    int required_end,
    DfsCtx *ctx
) {
    int added = 0;
    if (!g_tables_ready)
        dfs_configure(g_width, g_height);

    while (1) {
        int white, n_open, black_open, hr;
        int nbrs[4];
        int nn = 0;
        int isolated[4];
        int niso = 0;
        int n_deg1, deg1_open[3];
        DfsMask open_cells, rscan;
        int k, i, d;

        if (dfs_cancelled())
            return dfs_fail(ctx, added);

        if (ctx->use_memo && memo_lookup(ctx->memo, head, rem, required_end))
            return dfs_fail(ctx, added);

        if (ctx->node_limit) {
            ctx->nodes[0] += 1;
            if (ctx->nodes[0] > ctx->node_limit)
                return dfs_fail(ctx, added);
        } else if (ctx->nodes) {
            ctx->nodes[0] += 1;
            if ((ctx->nodes[0] & 4095) == 0 && dfs_cancelled())
                return dfs_fail(ctx, added);
        }

        if (nleft <= 1) {
            if (required_end < 0 || head == required_end) {
                if (ctx->path && ctx->path_len < ctx->path_cap)
                    ctx->path[ctx->path_len++] = head;
                return 1;
            }
            return dfs_fail(ctx, added);
        }
        if (required_end >= 0 && head == required_end)
            return dfs_fail(ctx, added);

        white = nleft - black;
        if (nleft & 1) {
            if (dfs_color_of(head)) {
                if (black != white + 1)
                    return dfs_fail(ctx, added);
            } else if (white != black + 1) {
                return dfs_fail(ctx, added);
            }
        } else if (black != white) {
            return dfs_fail(ctx, added);
        }

        open_cells = dfs_bit_clear(rem, head);
        n_open = nleft - 1;
        black_open = black - (dfs_color_of(head) ? 1 : 0);

        for (k = 0; k < g_nbr_count[head]; k++) {
            int n = g_nbrs[head][k];
            if (dfs_bit_test(open_cells, n))
                nbrs[nn++] = n;
        }
        if (!nn)
            return dfs_fail(ctx, added);

        for (k = 0; k < nn; k++) {
            if (dfs_degree(nbrs[k], open_cells) == 0)
                isolated[niso++] = nbrs[k];
        }
        if (niso) {
            if (niso > 1 || n_open != 1)
                return dfs_fail(ctx, added);
            nbrs[0] = isolated[0];
            nn = 1;
        }

        if (nn == 1) {
            if (ctx->path && ctx->path_len < ctx->path_cap) {
                ctx->path[ctx->path_len++] = head;
                added++;
            }
            head = nbrs[0];
            rem = open_cells;
            nleft = n_open;
            black = black_open;
            continue;
        }

        n_deg1 = 0;
        rscan = open_cells;
        while (!dfs_mask_empty(rscan)) {
            i = dfs_mask_lowest(rscan);
            rscan = dfs_mask_clear_lowest(rscan);
            d = dfs_degree(i, open_cells);
            if (d == 0)
                return dfs_fail(ctx, added);
            if (d == 1) {
                n_deg1++;
                if (n_deg1 > 2)
                    return dfs_fail(ctx, added);
                deg1_open[n_deg1 - 1] = i;
            }
        }
        if (n_deg1 == 2) {
            int filtered[4];
            int nf = 0;
            for (k = 0; k < nn; k++) {
                if (nbrs[k] == deg1_open[0] || nbrs[k] == deg1_open[1])
                    filtered[nf++] = nbrs[k];
            }
            if (!nf)
                return dfs_fail(ctx, added);
            for (k = 0; k < nf; k++)
                nbrs[k] = filtered[k];
            nn = nf;
        }

        hr = head / g_width;
        for (k = 0; k < nn; k++) {
            int best = k;
            int bdeg, btie, jk, jdeg, jtie;
            bdeg = dfs_degree(nbrs[k], open_cells);
            btie = ((hr % 2 == 0 && nbrs[k] == head + 1) || (hr % 2 == 1 && nbrs[k] == head - 1)) ? 0 : 1;
            for (jk = k + 1; jk < nn; jk++) {
                jdeg = dfs_degree(nbrs[jk], open_cells);
                jtie = ((hr % 2 == 0 && nbrs[jk] == head + 1) || (hr % 2 == 1 && nbrs[jk] == head - 1)) ? 0 : 1;
                if (jdeg < bdeg || (jdeg == bdeg && jtie < btie)) {
                    best = jk;
                    bdeg = jdeg;
                    btie = jtie;
                }
            }
            if (best != k) {
                int tmp = nbrs[k];
                nbrs[k] = nbrs[best];
                nbrs[best] = tmp;
            }
        }

        if (ctx->path && ctx->path_len < ctx->path_cap) {
            ctx->path[ctx->path_len++] = head;
            added++;
        }

        for (k = 0; k < nn; k++) {
            int n = nbrs[k];
            if (dfs_cancelled())
                return dfs_fail(ctx, added);
            if (!dfs_mask_eq(dfs_reachable_mask(n, open_cells), open_cells))
                continue;
            if (warnsdorff_dfs_inner(n, open_cells, n_open, black_open, required_end, ctx))
                return 1;
        }

        if (ctx->use_memo)
            memo_insert(ctx->memo, head, rem, required_end);
        return dfs_fail(ctx, added);
    }
}

int warnsdorff_dfs_run(
    int head,
    const uint64_t *rem_words,
    int nleft,
    int black,
    int required_end, /* -1 = None */
    int node_limit,
    int want_path,
    int use_memo,
    int *path_out,
    int path_cap,
    int *path_len_out,
    int *nodes_out
) {
    DfsMask rem;
    DfsCtx ctx;
    MemoTable memo;
    int ok;
    int nodes_local = 0;

    dfs_mask_from_words(&rem, rem_words);
    memset(&ctx, 0, sizeof(ctx));
    memset(&memo, 0, sizeof(memo));
    ctx.nodes = nodes_out ? nodes_out : &nodes_local;
    ctx.node_limit = node_limit;
    if (want_path) {
        ctx.path = path_out;
        ctx.path_cap = path_cap;
    }
    ctx.path_len = 0;
    ctx.use_memo = use_memo;
    ctx.memo = use_memo ? &memo : NULL;

    ok = warnsdorff_dfs_inner(head, rem, nleft, black, required_end, &ctx);
    if (path_len_out)
        *path_len_out = ctx.path_len;
    if (nodes_out && !node_limit)
        *nodes_out = ctx.nodes[0];
    memo_free(&memo);
    return ok;
}
