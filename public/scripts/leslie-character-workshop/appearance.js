export const APPEARANCE_CHOICES = {
    height: [['常用身高', ['150 cm', '160 cm', '165 cm', '170 cm', '175 cm', '180 cm']]],
    weight: [['常用体重', ['45 kg', '50 kg', '55 kg', '60 kg', '65 kg', '70 kg']]],
    bodyType: [['体型', ['清瘦', '匀称', '结实', '微胖']], ['体态', ['站姿挺直', '动作轻盈', '姿态放松']]],
    hair: [['长度', ['短发', '齐肩发', '长发']], ['发型', ['直发', '自然卷', '波浪卷', '马尾', '双马尾']], ['发色', ['黑发', '棕发', '金发', '银白发', '红发', '蓝发']]],
    eyes: [['瞳色', ['黑色瞳孔', '棕色瞳孔', '蓝色瞳孔', '绿色瞳孔', '灰色瞳孔']], ['神态', ['眼神温和', '眼神锐利', '眼神灵动', '眼神疲倦']]],
    clothing: [['穿着风格', ['休闲装', '校服', '运动装', '正装', '工作服', '古风服饰', '奇幻冒险装']], ['常用单品', ['衬衫', '针织衫', '连帽衫', '长外套', '长裙']]],
    distinctiveFeatures: [['配饰', ['细框眼镜', '圆框眼镜', '耳饰', '发夹', '围巾']], ['特征', ['雀斑', '酒窝', '脸上小痣', '眉间疤痕']]],
};

export function toggleAppearanceChoice(value, field, group, choice) {
    const choices = APPEARANCE_CHOICES[field]?.[group]?.[1];
    if (!choices?.includes(choice)) return String(value ?? '');
    const parts = String(value ?? '').split(/[、，,]/u).map(part => part.trim()).filter(Boolean);
    const selected = parts.includes(choice);
    if (field === 'height' || field === 'weight') return selected ? '' : choice;
    const kept = parts.filter(part => !choices.includes(part));
    if (!selected) kept.push(choice);
    return kept.join('、');
}

export function syncAppearanceChoices(root) {
    for (const button of root.querySelectorAll('[data-appearance-choice]')) {
        const value = root.querySelector(`[data-workshop-field="${button.dataset.appearanceField}"]`)?.value ?? '';
        button.setAttribute('aria-pressed', String(value.split(/[、，,]/u).map(part => part.trim()).includes(button.dataset.appearanceChoice)));
    }
}
