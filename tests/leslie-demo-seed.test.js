import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { seedDemoContent } from '../src/leslie-demo-mode/seed.js';
import { USER_DIRECTORY_TEMPLATE } from '../src/constants.js';
import { read as readCard } from '../src/character-card-parser.js';
import { LeslieMemoryStore } from '../src/leslie-memory/store.js';
import { LeslieMomentsStore } from '../src/leslie-moments/store.js';
import { LeslieMomentsActivityStore } from '../src/leslie-moments/activity-store.js';

let workspace;
let directories;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamland-demo-seed-'));
    const root = path.join(workspace, '_demo', 'alice');
    directories = Object.fromEntries(Object.entries(USER_DIRECTORY_TEMPLATE).map(([key, relative]) => [key, path.join(root, relative)]));
    for (const folder of Object.values(directories)) fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ username: 'Demo User', user_avatar: 'user-default.png', firstRun: true }));
});
afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

test('provides native cards and JSONL chats, social threads, growth and calculated relationship scores', () => {
    seedDemoContent(directories, 'alice');
    const cards = fs.readdirSync(directories.characters);
    expect(cards).toHaveLength(3);
    const memories = new LeslieMemoryStore(directories.root);
    const sources = memories.listMemorySources();
    expect(sources).toHaveLength(6);
    for (const avatar of cards) {
        const card = JSON.parse(readCard(fs.readFileSync(path.join(directories.characters, avatar))));
        expect(card.data.extensions.dreamland_demo.version).toBe(1);
        const folder = path.join(directories.chats, path.basename(avatar, '.png'));
        const chats = fs.readdirSync(folder);
        expect(chats).toHaveLength(2);
        for (const chatFile of chats) {
            const entries = fs.readFileSync(path.join(folder, chatFile), 'utf8').trim().split('\n').map(line => JSON.parse(line));
            expect(entries).toHaveLength(17);
            const id = entries[0].chat_metadata.leslie_memory.id;
            const memory = memories.getMemory(id);
            expect(memory.state.growth.summary.length).toBeGreaterThan(10);
            expect(memory.state.analysis.autoExtract).toBe(false);
            expect(memories.readEvents(id)).toHaveLength(14);
            expect(memories.getRelationship(id, { currentMessageId: 15 }).overall).toBeGreaterThan(0);
        }
    }
    const posts = new LeslieMomentsActivityStore(directories.root).decoratePosts(new LeslieMomentsStore(directories.root).listPosts().posts);
    expect(posts).toHaveLength(12);
    expect(posts.filter(post => post.reactions.likes.length)).toHaveLength(6);
    expect(posts.reduce((count, post) => count + post.reactions.comments.length, 0)).toBe(18);
});

test('is idempotent and leaves edited demo data and real account data intact', () => {
    const real = path.join(workspace, 'alice');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'canary.txt'), 'synthetic regular account');
    seedDemoContent(directories, 'alice');
    const card = path.join(directories.characters, fs.readdirSync(directories.characters)[0]);
    const original = fs.readFileSync(card);
    const moments = new LeslieMomentsStore(directories.root);
    const post = moments.listPosts().posts.find(post => post.author.type === 'persona');
    moments.updatePost(post.id, { authorEntityId: post.author.entityId, content: 'Edited synthetic post', visibility: { type: 'all' } });
    seedDemoContent(directories, 'alice');
    expect(fs.readFileSync(card)).toEqual(original);
    expect(moments.getPost(post.id).content).toBe('Edited synthetic post');
    expect(moments.listPosts().posts).toHaveLength(12);
    expect(fs.readFileSync(path.join(real, 'canary.txt'), 'utf8')).toBe('synthetic regular account');
    expect(() => seedDemoContent({ ...directories, root: real }, 'alice')).toThrow();
});
