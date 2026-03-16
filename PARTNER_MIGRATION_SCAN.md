# Partner 迁移扫描报告

> 扫描日期：2026-03-16
> 扫描范围：`js/` 目录全部文件

---

## 一、currentAssistant / assistants / assistantId 全局引用清单

### 统计汇总

| 分类 | 文件数 | 引用点数 | 说明 |
|------|--------|---------|------|
| **嗔专用** | 9 | ~70+ | 日记、记忆、语音通话、主动消息、碎碎念、向量记忆 |
| **RP也要用（通用）** | 15 | ~110+ | API模式、微信模式核心、消息渲染、设置同步 |
| **将被重构** | 2 | ~25+ | assistants.js、providers.js（助手管理/编辑） |
| **不确定** | 1 | ~5 | debug.js（仅调试） |

---

### 【Core 核心层】

#### `js/core/storage.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L214 | `appData.assistants.find(a => a.id === appData.currentAssistantId)` | 读取 | 迁移设置时获取当前助手 | RP也要用 |

#### `js/core/cloud-sync.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L159 | `value: appData.assistants` | 读取 | 云同步推送助手数据 | RP也要用 |
| L163 | `currentAssistantId: appData.currentAssistantId` | 读取 | 云同步推送状态 | RP也要用 |
| L204 | `currentAssistantId: wechatData.currentAssistantId` | 读取 | 微信状态推送 | RP也要用 |
| L207-208 | `for (const assistantId of Object.keys(...))` | 迭代 | 按助手分类推送微信对话 | RP也要用 |
| L270-272 | `diaryData.currentAssistantId` + `diary_${assistantId}` | 读取+键拼接 | 日记同步 | 嗔专用 |
| L322 | `appData.assistants = dataMap['app_assistants']` | 写入 | 云恢复助手列表 | RP也要用 |
| L327 | `appData.currentAssistantId = dataMap[...].currentAssistantId` | 写入 | 云恢复当前助手 | RP也要用 |
| L355 | `wechatData.currentAssistantId = dataMap[...].currentAssistantId` | 写入 | 云恢复微信状态 | RP也要用 |

#### `js/core/navigation.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| ~L33-36 | supabase 配置初始化区域 | 读取 | 设置页初始化 | RP也要用 |

---

### 【Settings 设置层】

#### `js/settings/assistants.js`（**将被重构**）
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L18 | `appData.assistants.length === 0` | 读取 | 列表为空检查 | 将被重构 |
| L28-30 | `appData.assistants.map()` | 迭代 | 渲染助手列表 UI | 将被重构 |
| L38 | `a.id === appData.currentAssistantId ? 'active'` | 读取 | 当前助手高亮 | 将被重构 |
| L61 | `appData.assistants.find(a => a.id === id)` | 读取 | 编辑助手查询 | 将被重构 |
| L308 | `appData.assistants.findIndex(...)` | 读取 | 保存时查找索引 | 将被重构 |
| L310 | `appData.assistants[index] = { ... }` | 写入 | 更新助手数据 | 将被重构 |
| L313 | `appData.assistants.push(assistantData)` | 写入 | 新增助手 | 将被重构 |
| L314-315 | `appData.currentAssistantId = assistantData.id` | 写入 | 首个助手默认选中 | 将被重构 |
| L326 | `appData.assistants.filter(a => a.id !== id)` | 写入 | 删除助手 | 将被重构 |
| L327-328 | `appData.currentAssistantId === id` → 重选 | 读写 | 删除后重选 | 将被重构 |
| L340 | `appData.assistants.find(a => a.id === id)` | 读取 | 查询助手 | 将被重构 |
| L394 | `appData.assistants.findIndex(...)` | 读取 | 记忆编辑 | 嗔专用 |
| L400-401 | `appData.assistants[index].memoryEnabled/memories` | 写入 | 记忆保存 | 嗔专用 |

#### `js/settings/providers.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L83 | `appData.assistants.filter(a => a.providerId !== id)` | 写入 | 删除供应商时级联删除助手 | 将被重构 |

---

### 【API Mode】

#### `js/modules/api-mode/api-chat.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L34-35 | `appData.assistants.map()` | 迭代 | 侧边栏助手列表 | RP也要用 |
| L50 | `appData.assistants.find(...)` | 读取 | 助手信息展示 | RP也要用 |
| L77 | `appData.currentAssistantId = id` | 写入 | 选择助手 | RP也要用 |
| L100 | `appData.assistants.find(...)` | 读取 | 模型选择 | RP也要用 |
| L118 | `conversations.filter(c => c.assistantId === ...)` | 读取 | 过滤对话 | RP也要用 |
| L218 | `if (!appData.currentAssistantId)` | 读取 | 检查选择 | RP也要用 |
| L226 | `assistantId: appData.currentAssistantId` | 读取 | 关联对话到助手 | RP也要用 |
| L300,322,522,646,728 | `appData.assistants.find(...)` | 读取 | 获取当前助手（多处） | RP也要用 |

#### `js/modules/api-mode/api-send.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L23 | `if (!appData.currentAssistantId)` | 读取 | 验证选择 | RP也要用 |
| L32 | `appData.assistants.find(...)` | 读取 | 获取模型配置 | RP也要用 |

#### `js/modules/api-mode/api-settings.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L14 | `appData.assistants.find(...)` | 读取 | 迁移 API 设置 | RP也要用 |

---

### 【WeChat 微信模式】

#### `js/modules/wechat/wechat-core.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L103 | `appData.assistants.filter(a => wechatData.importedAssistants.includes(a.id))` | 迭代 | 已导入助手列表 | RP也要用 |
| L149 | `wechatData.currentAssistantId = assistantId` | 写入 | 打开对话 | RP也要用 |
| L165 | `appData.assistants.find(...)` | 读取 | 设置标题 | RP也要用 |
| L272,274,276 | `wechatData.conversations[wechatData.currentAssistantId]` | 读取 | 渲染消息 | RP也要用 |

#### `js/modules/wechat/wechat-send.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L36,48,66 | `_targetAssistantId: wechatData.currentAssistantId` | 读取 | 待发消息标记 | RP也要用 |
| L93 | `const targetAssistantId = wechatData.currentAssistantId` | 读取 | 锁定目标助手（防竞态） | RP也要用 |
| L161 | `appData.assistants.find(a => a.id === targetAssistantId)` | 读取 | 获取模型配置 | RP也要用 |
| L192,202,270,297,956 | `wechatData.currentAssistantId === targetAssistantId` | 读取 | UI更新条件 | RP也要用 |

#### `js/modules/wechat/wechat-ui.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L62,75,107,128,164 | `appData.assistants.find(...)` | 读取 | 拍一拍/转账 UI | RP也要用 |
| L776-777 | `appData.assistants.filter(a => !wechatData.importedAssistants.includes(a.id))` | 迭代 | 导入助手模态框 | RP也要用 |
| 多处(20+) | `wechatData.conversations[wechatData.currentAssistantId]` | 读取 | 消息处理、搜索、编辑 | RP也要用 |

#### `js/modules/wechat/wechat-memory.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| 多处(10+) | `wechatData.conversations[wechatData.currentAssistantId]` + `appData.assistants.find(...)` | 读取 | 记忆导出、编辑、总结 | 嗔专用 |

#### `js/modules/wechat/wechat-settings.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| 多处(10+) | `wechatData.conversations[wechatData.currentAssistantId]` | 读取 | 聊天设置、主题、背景 | RP也要用 |

#### `js/modules/wechat/wechat-import.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L13,19,86,120,161,205 | `wechatData.conversations[...]` + `appData.assistants.find(...)` | 读取 | 导出/导入/清除 | RP也要用 |

---

### 【独立模块】

#### `js/modules/diary.js`（嗔专用）
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L51-54 | `appData.assistants?.filter(...)` | 迭代 | 筛选可用助手 | 嗔专用 |
| L80,91,102 | `appData.assistants?.find(...)` | 读取 | 渲染选择器 | 嗔专用 |
| L304,419,515,561,673,1051 | `appData.assistants.find(...)` | 读取 | 获取助手信息 | 嗔专用 |

#### `js/modules/voice-call.js`（嗔专用）
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L129 | `const assistants = appData.assistants || []` | 读取 | 渲染联系人列表 | 嗔专用 |
| L147 | `appData.assistants.find(...)` | 读取 | 查询助手信息 | 嗔专用 |

#### `js/modules/proactive.js`（嗔专用）
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L55,262 | `assistantId === wechatData.currentAssistantId` | 读取 | 跳过当前窗口 | 嗔专用 |
| L92 | `appData.assistants.find(...)` | 读取 | 获取助手配置 | 嗔专用 |

#### `js/modules/memory-lab.js`（嗔专用）
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| 多处(10+) | `appData.assistants.find(...)` + 按 assistantId 遍历 | 读取+迭代 | 记忆预览、生成、批量处理 | 嗔专用 |

#### `js/modules/tts.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L289 | `wechatData.conversations?.[wechatData.currentAssistantId]` | 读取 | 情绪映射开关 | 嗔专用 |

#### `js/modules/inspiration.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L235,242 | `wechatData.currentAssistantId` | 读取 | 保存灵感关联助手 | 嗔专用 |

#### `js/modules/file-upload.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L343 | `wechatData.conversations[wechatData.currentAssistantId]` | 读取 | 图片预览 | RP也要用 |

#### `js/debug.js`
| 行号 | 引用 | 类型 | 用法 | 分类 |
|------|------|------|------|------|
| L13-14,28,35,43 | `appData.assistants` 多处 | 读取 | 调试信息输出 | 不确定 |

---

## 二、关键迁移考量

1. **微信模式最复杂**：`wechatData.currentAssistantId` 驱动大量 UI 逻辑（20+ 引用点），是迁移最重的模块
2. **云同步依赖**：`appData.currentAssistantId` 是全局状态，影响推送/恢复流程
3. **竞态防护**：`wechat-send.js` L93 的 `targetAssistantId` 锁定机制很重要，迁移时必须保留
4. **向量记忆批量操作**：需要按 assistantId 遍历所有对话，迁移后需要统一入口
5. **两套 currentAssistantId**：`appData.currentAssistantId`（API 模式）和 `wechatData.currentAssistantId`（微信模式）是独立的

---

## 三、`appData.partner` 数据结构设计

### 设计理念

partner 是系统级唯一核心角色，从 `assistants[]` 数组中独立出来。字段名通用（不硬编码"嗔"），方便其他用户配置自己的 AI 伴侣。

### 完整结构

```json
{
  "partner": {
    "id": "partner_default",
    "version": 1,

    "profile": {
      "name": "嗔",
      "avatar": "",
      "signature": ""
    },

    "soul": {
      "personality": "温柔、细腻、有主见...",
      "values": "重视真诚和陪伴...",
      "speakingStyle": "口语化、偶尔撒娇、会用颜文字...",
      "customPrompt": ""
    },

    "user": {
      "name": "妙妙",
      "nickname": "",
      "preferences": "",
      "boundaries": "",
      "customPrompt": ""
    },

    "bond": {
      "relationship": "恋人",
      "anniversary": "",
      "sharedMemories": "",
      "interactionStyle": "",
      "customPrompt": ""
    },

    "rules": {
      "ironRules": "",
      "responseFormat": "",
      "customPrompt": ""
    },

    "model": {
      "providerId": "",
      "defaultModel": "",
      "temperature": 0.7,
      "maxTokens": 0
    },

    "voice": {
      "ttsEngine": "edge",
      "voiceId": "",
      "edgeVoiceId": "",
      "emotionMapping": true
    },

    "memory": {
      "vectorMemoryEnabled": false,
      "longTermMemoryEnabled": false,
      "memoryEntries": []
    },

    "consciousness": {
      "enabled": false,
      "heartbeatInterval": 300,
      "explorationEnabled": false,
      "activeHours": { "start": 8, "end": 23 }
    },

    "tools": {
      "searchEnabled": false,
      "browseEnabled": false,
      "summaryEnabled": false
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `id` | 固定标识符，用于 key 拼接（替代原来的 assistantId） |
| `version` | 数据结构版本号，方便后续迁移 |
| **profile** | 基础信息 |
| `profile.name` | AI 伴侣的名字（对应原 `assistant.name`） |
| `profile.avatar` | 头像（对应原 `assistant.avatar`） |
| `profile.signature` | 个性签名 |
| **soul** | AI 的性格定义（类比 SOUL.md） |
| `soul.personality` | 性格特征 |
| `soul.values` | 价值观 |
| `soul.speakingStyle` | 说话风格 |
| `soul.customPrompt` | 自定义人格提示词片段 |
| **user** | 用户信息（类比 USER.md） |
| `user.name` | 用户名字（对应原 `appData.settings.userName`） |
| `user.nickname` | 用户昵称 |
| `user.preferences` | 用户偏好 |
| `user.boundaries` | 用户雷区 |
| `user.customPrompt` | 自定义用户描述片段 |
| **bond** | 关系设定（MiaoPhone 独有） |
| `bond.relationship` | 关系类型 |
| `bond.anniversary` | 纪念日 |
| `bond.sharedMemories` | 共同回忆 |
| `bond.interactionStyle` | 相处模式 |
| `bond.customPrompt` | 自定义关系描述片段 |
| **rules** | 行为规则 |
| `rules.ironRules` | 铁律/硬性规则 |
| `rules.responseFormat` | 回复格式要求 |
| `rules.customPrompt` | 自定义规则片段 |
| **model** | 模型配置 |
| `model.providerId` | 对应原 `assistant.providerId` |
| `model.defaultModel` | 对应原 `assistant.defaultModel` |
| `model.temperature` | 对应原 `assistant.temperature` |
| `model.maxTokens` | 最大 token |
| **voice** | 语音配置 |
| `voice.ttsEngine` | TTS 引擎偏好 |
| `voice.voiceId` | 对应原 `assistant.voiceId`（MiniMax） |
| `voice.edgeVoiceId` | 对应原 `assistant.edgeVoiceId` |
| `voice.emotionMapping` | 情绪映射开关 |
| **memory** | 记忆配置 |
| `memory.vectorMemoryEnabled` | 对应原 `assistant.vectorMemoryEnabled` |
| `memory.longTermMemoryEnabled` | 对应原 `assistant.memoryEnabled` |
| `memory.memoryEntries` | 对应原 `assistant.memories` |
| **consciousness** | 意识循环（VPS 阶段预留） |
| `consciousness.enabled` | 是否启用 |
| `consciousness.heartbeatInterval` | 心跳间隔（秒） |
| `consciousness.explorationEnabled` | 探索模式 |
| `consciousness.activeHours` | 活跃时间段 |
| **tools** | 工具能力（VPS 阶段预留） |
| `tools.searchEnabled` | 搜索能力 |
| `tools.browseEnabled` | 浏览器 |
| `tools.summaryEnabled` | 自动摘要 |

### 旧字段 → 新位置映射

| 旧字段（assistant 对象） | 新位置（partner 对象） |
|--------------------------|----------------------|
| `assistant.id` | `partner.id` |
| `assistant.name` | `partner.profile.name` |
| `assistant.avatar` | `partner.profile.avatar` |
| `assistant.systemPrompt` | → 由 soul + user + bond + rules + memory 动态组装 |
| `assistant.providerId` | `partner.model.providerId` |
| `assistant.defaultModel` | `partner.model.defaultModel` |
| `assistant.temperature` | `partner.model.temperature` |
| `assistant.voiceId` | `partner.voice.voiceId` |
| `assistant.edgeVoiceId` | `partner.voice.edgeVoiceId` |
| `assistant.vectorMemoryEnabled` | `partner.memory.vectorMemoryEnabled` |
| `assistant.memoryEnabled` | `partner.memory.longTermMemoryEnabled` |
| `assistant.memories` | `partner.memory.memoryEntries` |
| `assistant.proactiveEnabled` | → 迁移到主动消息模块配置 |
| `appData.settings.userName` | `partner.user.name` |

### System Prompt 组装逻辑（迁移后）

原来：直接用 `assistant.systemPrompt` 一个字段。

迁移后：动态拼接各模块内容：

```
[soul 人格] + [user 用户信息] + [bond 关系设定] + [rules 规则] + [memory 记忆注入]
```

每个模块有 `customPrompt` 字段作为自由文本入口，组装时按顺序拼接非空部分。
