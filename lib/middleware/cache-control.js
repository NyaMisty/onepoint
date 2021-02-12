const logger = require('../utils/logger');
const {RTError} = require('../utils/node');
const {CACHE_TIME_FILE, CACHE_TIME_LIST} = require('../conf/sys-config');
module.exports = async (ctx, next) => {
    const path = ctx.state.p1 + ctx.state.p2;
    // use cache
    if (ctx.state.useCache) {
        const m = oneCache.getMsg(path, ctx.$data.page);
        if (m) {
            logger.info('cache hit');
            if (m.list) {
                ctx.respondList(m.list, m.nextToken);
            } else if (m.one) {
                ctx.respondOne(m.one, m.down);
            }
            ctx.response.data.cached = true;
            return;
        }
    }

    await next();

    if (ctx.response.isList) {
        const d = ctx.response.data;
        oneCache.addList(path, d.list, d.nextToken, ctx.$data.page);
    } else if (ctx.response.isFile) {
        oneCache.addOne(path, ctx.response.data.file, ctx.response.down);
    } else if (ctx.response.isFolder) {
        oneCache.addOne(path, ctx.response.data.folder);
    }
};

class OneCache {
    constructor() {
        this.root = {next: {}};
    }

    addList(path, list, nextToken, page = 0) {
        const p = this.getNode(path, true);
        const oNext = p.next;
        const next = {};
        const expT = Date.now() + CACHE_TIME_FILE;
        list.forEach((e) => {
            next[e.name] = {
                value: e,
                next: oNext[e.name] ? oNext[e.name].next : {},
                expT: (e.url || e.type !== 0) ? expT : 0,
            };
        });
        p.next = next;

        if (page || nextToken) {
            // 一锅炖不下
            if (!p.pages) {
                p.pages = {};
            }
            p.pages[page] = {list, nextToken, expT: Date.now() + CACHE_TIME_LIST};
        } else {
            p.expTL = Date.now() + CACHE_TIME_LIST;
        }
    }

    addOne(path, item, down = null) {
        const p = this.getNode(path, true);
        p.value = item;
        p.down = down ? JSON.stringify(down) : null;
        p.expT = Date.now() + CACHE_TIME_FILE;
    }

    getNode(path, addIfAbsent) {
        let p = this.root;
        for (const i of path.split('/').filter((e) => e)) {
            if (!p.next[i]) {
                if (!addIfAbsent) {
                    return;
                }
                p.next[i] = {next: {}};
            }
            p = p.next[i];
        }
        return p;
    }

    getMsg(path, page = 0) {
        const p = this.getNode(path);
        if (!p) {
            return;
        }

        if (path.endsWith('/')) {
            if ((p.expTL || 0) > Date.now()) {
                return {list: Object.values(p.next).map((e) => e.value)};
            }
            if (p.pages && p.pages[page] && p.pages[page].expT > Date.now()) {
                return p.pages[page];
            }
            if (p.value && p.value.type === 0) {
                throw new RTError(400, 'ItemIsFile');
            }
        } else {
            if ((p.expT || 0) > Date.now()) {
                return {one: p.value, down: p.down ? JSON.parse(p.down) : null};
            }
        }
    }

    drop(path = '/') {
        if (path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        const pPath = path.slice(0, path.lastIndexOf('/'));
        if (pPath === '') {
            this.root = {next: {}};
            return;
        }
        const pp = this.getNode(pPath);
        if (!pp) {
            return;
        }
        const name = path.slice(path.lastIndexOf('/') + 1);
        delete pp.next[name];
        delete pp.pages;
    }
}

const oneCache = new OneCache();