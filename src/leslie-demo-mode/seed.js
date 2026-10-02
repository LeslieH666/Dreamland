import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { write as writeCard } from '../character-card-parser.js';
import { LeslieIdentityStore } from '../leslie-identity/store.js';
import { LeslieMemoryStore } from '../leslie-memory/store.js';
import { LeslieMomentsStore } from '../leslie-moments/store.js';
import { LeslieMomentsActivityStore } from '../leslie-moments/activity-store.js';
import { buildMemoryIdentityBinding, upsertMemoryMetadata } from '../../public/scripts/extensions/leslie-memory/identity-context.js';

const SCENARIOS = [
    { key: 'star', name: '星澄 · 星空演示', personality: '温柔、好奇，喜欢天文与倾听。', activity: '去天台看流星',
        lines: ['今晚云很少，天台的视野一定不错。', '我带了星图，还准备了一壶热茶。', '你想先找北斗，还是等第一颗流星？', '不着急认清每颗星，坐下来聊聊也很好。', '上次你说喜欢安静的夜晚，我记住了。', '如果有愿望，现在可以悄悄许一个。', '看见了！刚刚那一道光，你也看到了吧？', '下次还是一起出发。我会提前查看天气。'],
        post: '今晚的第一颗流星，和朋友一起看到了。热茶、星图，还有慢慢聊完的故事。',
        growth: '从独自观星到主动邀请朋友，开始愿意分享自己的期待。' },
    { key: 'library', name: '遥 · 书店演示', personality: '沉稳、细心，喜欢书籍和雨天散步。', activity: '整理旧书店',
        lines: ['雨停了，书店门口还有一点湿润的木头味道。', '这本旧游记夹着一张褪色的车票。', '你愿意帮我把这排书按主题整理吗？', '不用赶时间，我们一册一册来。', '谢谢你记得我不喜欢把书页折起来。', '这张书签送给你，下次看到喜欢的段落可以标下来。', '整理完了！最难找的那册书也终于归位。', '明天来读读游记吧，也许会找到下一段旅程。'],
        post: '旧书架整理好了。一张车票、一段手写批注，让普通的下午有了新的故事。',
        growth: '学会接受帮助；遇到分歧时先解释自己的想法，再一起寻找办法。' },
    { key: 'cafe', name: '澪 · 日常演示', personality: '开朗、可靠，喜欢烘焙与记录日常。', activity: '做一盘柠檬饼干',
        lines: ['第一盘饼干出炉了！厨房都是柠檬的香气。', '这次我少放了一点糖，你帮我尝尝好吗？', '边缘有一点焦，不过中间应该很松软。', '你说得对，下次可以把烘烤时间缩短两分钟。', '谢谢你没有只说好吃，认真建议真的帮到我了。', '给邻居留一盒吧，分享快乐也是配方的一部分。', '新配方记好了：少糖、薄一点、烤十二分钟。', '我们周末再做一次，到时候就轮到你选口味。'],
        post: '少糖柠檬饼干成功啦！记下了新的配方，也给朋友留了最香的一盒。',
        growth: '能够坦然接受建议，逐渐把对结果的焦虑转化为尝试新配方的动力。' },
];

/** Seed only the reserved demo namespace; never copy any real account content. */
export function seedDemoContent(directories, accountHandle) {
    const root = path.resolve(directories.root);
    if (path.basename(path.dirname(root)) !== '_demo' || path.basename(root) !== accountHandle) throw new Error('Demo seeding requires an isolated demo directory.');
    const marker = path.join(root, 'leslie', 'demo-content-v1.json');
    if (fs.existsSync(marker)) return;
    const settingsFile = path.join(root, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const persona = { type: 'persona', sourceKey: settings.user_avatar || 'user-default.png', label: settings.username || 'User' };
    const identities = new LeslieIdentityStore(root);
    const memories = new LeslieMemoryStore(root);
    const moments = new LeslieMomentsStore(root);
    const activity = new LeslieMomentsActivityStore(root);
    const image = fs.readFileSync(fileURLToPath(new URL('../../public/img/dreamland/icon-192.png', import.meta.url)));
    const now = Date.now();
    const stamp = offset => new Date(now - offset * 60_000).toISOString();
    for (const [index, scenario] of SCENARIOS.entries()) {
        const avatar = `dreamland-demo-${scenario.key}.png`;
        const cardFile = path.join(directories.characters, avatar);
        // A reserved-name collision must never replace a user's edited card.
        if (fs.existsSync(cardFile)) continue;
        const data = { name: scenario.name, description: `完全虚构的演示角色，用于体验聊天、记忆与关系量化。${scenario.personality}`, personality: scenario.personality,
            scenario: `与演示用户一起${scenario.activity}。`, first_mes: scenario.lines[0], mes_example: '', creator_notes: 'DreamLand 合成演示内容。', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
            tags: ['合成演示'], creator: 'DreamLand', character_version: '1', extensions: { dreamland_demo: { version: 1 } } };
        for (const kind of ['story', 'reality']) {
            const chatName = `演示 · ${kind === 'story' ? '故事线' : '现实线'} · ${scenario.key}`;
            const chatKey = `${avatar}::${chatName}`;
            const resolution = identities.resolveStoryScope({ persona, counterpart: { type: 'character', sourceKey: avatar, label: scenario.name }, chat: { chatKey } });
            const identityBinding = buildMemoryIdentityBinding(resolution, { worldLine: kind });
            const memory = memories.createMemory({ chatKey, characterKey: avatar, coreSnapshot: { ...data, avatar }, identityBinding });
            const summaries = ['尊重彼此的表达，不用猜测代替询问。', `约定一起${scenario.activity}，并认真完成准备。`, '演示用户愿意听完整段故事，再给出建议。', '一次小小的帮助让彼此更有安全感。', '记住了朋友喜欢慢节奏交流。', '分享了今天的发现和一件有趣的小事。', '讨论计划时主动说明自己的顾虑。', '共同完成任务后约好下次继续。', '今天准备了热茶，也留出了休息时间。', '最近正在尝试更主动地表达感谢。', '期待下一次碰面，但不会催促回复。', '一次误会通过直接交流得到澄清。'];
            const events = memories.upsertEvents(memory.manifest.id, summaries.map((summary, i) => ({ summary: `${scenario.name}：${summary}`, level: i < 4 ? 'A' : i < 8 ? 'B' : 'C',
                tags: ['演示', '共同经历'], importance: 80 + index * 5, confidence: 1, approved: true,
                source: [{ messageId: Math.min(15, i + 2), swipeId: 0, hash: 'synthetic-demo' }],
                relationshipImpact: { source: 'manual', reason: '合成对话中的互相尊重与支持。', changes: { affection: 2, trust: 3, rapport: 1 + index, security: 2, bond: 1, intimacy: 1 } } })));
            memories.upsertEvents(memory.manifest.id, [{ summary: '尚待用户确认的合成记忆。', level: 'B', status: 'pending', approved: false, tags: ['演示', '待确认'] }, { summary: '已归档的旧计划，保留用于查看历史。', level: 'C', status: 'archived', tags: ['演示', '已归档'] }]);
            memories.updateState(memory.manifest.id, { enabled: true, analysis: { autoExtract: false }, growth: { summary: scenario.growth, relationship: '从初识到逐渐熟悉，保持尊重与清晰边界。', traits: ['愿意倾听', '表达更主动'], goals: [`继续${scenario.activity}`], evidenceEventIds: events.map(event => event.id) }, relationship: { enabled: true } });
            const metadata = { persona: persona.sourceKey, leslie_memory: upsertMemoryMetadata({}, { memoryId: memory.manifest.id, chatKey, identityBinding }),
                leslie_world_line: { schemaVersion: 2, kind, personaSourceKey: persona.sourceKey, ...(kind === 'reality' ? { realityProfile: { schemaVersion: 1, traits: [scenario.personality], emotionalStyle: '温和坦诚', messageStyle: '自然的即时聊天', boundaries: ['尊重彼此'], sourceHash: 'synthetic-demo' } } : {}) } };
            const messages = scenario.lines.flatMap((line, i) => [
                { name: scenario.name, is_user: false, is_system: false, mes: kind === 'story' && i === 0 ? `*她抬起头，朝你微笑。*\n\n${line}` : line, send_date: stamp(30 + index * 20 - i * 2) },
                { name: persona.label, is_user: true, is_system: false, mes: ['好呀，我们一起去。', '我也准备好了，慢慢来就行。', '先听听你的想法吧。', '这样安排很合适。', '我很开心你记得这件事。', '下次也一起试试。', '今天真的很有收获。', '说好了，我会记得我们的约定。'][i], send_date: stamp(29 + index * 20 - i * 2) },
            ]);
            const folder = path.join(directories.chats, path.basename(avatar, '.png'));
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, `${chatName}.jsonl`), [{ user_name: persona.label, character_name: scenario.name, chat_metadata: metadata }, ...messages].map(value => JSON.stringify(value)).join('\n') + '\n', { flag: 'wx' });
            const author = { entityId: resolution.counterpart.id, type: 'character', sourceKey: avatar, label: scenario.name, avatar };
            const user = { entityId: resolution.persona.id, ...persona };
            const post = moments.createPost({ mode: 'character', worldLine: kind, author, content: scenario.post, visibility: { type: 'all' } });
            activity.setLike(post, user, true);
            const comment = activity.addComment(post, user, '下次也一起去吧，今天很开心！');
            activity.addComment(post, author, '好呀，我也记住这个约定了。', { parentCommentId: comment.id, source: 'ai' });
            const userPost = moments.createPost({ mode: 'aside', worldLine: kind, author: user, content: `和${scenario.name}一起${scenario.activity}。每次认真交流都让关系更清晰，也学会把承诺落到小事上。`, visibility: { type: 'all' } });
            activity.addComment(userPost, author, '谢谢你认真记下这些小事。', { source: 'ai' });
        }
        const chat = `演示 · 故事线 · ${scenario.key}`;
        const card = { ...data, data, spec: 'chara_card_v2', spec_version: '2.0', chat, create_date: stamp(90 + index), fav: false };
        fs.writeFileSync(cardFile, writeCard(image, JSON.stringify(card)), { flag: 'wx' });
    }
    if (settings.firstRun) { settings.firstRun = false; writeFileAtomicSync(settingsFile, JSON.stringify(settings), 'utf8'); }
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    writeFileAtomicSync(marker, JSON.stringify({ schemaVersion: 1, synthetic: true }), 'utf8');
}
