/**
 * The AI idea cards: one per main idea of the design's "Explanation (light touch)", each 2–3 sentences ending with
 * how a real chatbot does it. A small "AI" badge opens one (`src/ui/aiCard.ts`). No DOM.
 */

export const CARD_KEYS = [
  'tokens', 'probabilities', 'pinned', 'buckets', 'agentLoop', 'leave', 'tools', 'torch', 'lessons', 'corrected',
  'pickaxe', 'practice', 'saga',
] as const;
export type CardKey = typeof CARD_KEYS[number];

export interface Card { title: string; text: string }

export const CARDS: Record<CardKey, Card> = {
  tokens: {
    title: 'Tokens and the context window',
    text: 'Each view he sees is an input token and each action he takes is an output token. His memory strip is his context window: the only past he can use, and the oldest turn drops out as a new one comes in. A chatbot reads your words as tokens too, and its context window holds the conversation so far, up to a fixed limit.',
  },
  probabilities: {
    title: 'Chances and boldness',
    text: 'Each turn his model gives all 9 actions a chance, and one is drawn at random, so no two raids are quite the same. Boldness sharpens or flattens those chances: low boldness nearly always takes the likeliest action, high boldness takes more long shots. A chatbot does the same for every word it writes, and its boldness dial is called temperature.',
  },
  pinned: {
    title: 'Pinned stats',
    text: 'His HP, gold, potions, time and the stairs compass sit at the front of his input every turn and never scroll out of his memory. A chatbot gets a system prompt the same way: instructions and facts placed before the conversation, always in its context.',
  },
  buckets: {
    title: 'Numbers in buckets',
    text: 'He never reads "HP 9", only "HP 7–10": numbers reach him chopped into rough buckets, so he cannot do exact sums with them. A chatbot reads numbers as tokens too, often split into odd chunks, which is one reason exact arithmetic is hard for it.',
  },
  agentLoop: {
    title: 'The world answers',
    text: 'After each action the dungeon answers: monsters move and hit, the torch burns down, and his next view shows what changed. This loop of act, answer, act again is how AI agents work: a chatbot calls a tool or asks you something, and the reply joins its context before its next step.',
  },
  leave: {
    title: 'Leave: knowing when to stop',
    text: 'Leave is his end token: taking it on the stairs ends the raid at once. Too early and he carries out little; too late and the gate closes on him and the gold is lost. A chatbot also writes a special end token when it decides its answer is finished.',
  },
  tools: {
    title: 'Actions that use things',
    text: 'Pick up, drink and light a torch do not move him; they use something, like tool calls. A chatbot can call tools the same way, such as a web search, a calculator or running code, and then reads what comes back.',
  },
  torch: {
    title: 'Torchlight',
    text: 'A lit torch shows him 5 × 5 cells instead of 3 × 3 for a while, but he has few torches and monsters notice him from further away. It is like retrieval: paying to bring more information into the context. A chatbot can search the web or your documents and put what it finds into its context before it answers.',
  },
  lessons: {
    title: 'Lessons from a teacher',
    text: 'In a lesson he guesses each next action of a teacher\'s raid, sees the real one, and his numbers shift a little toward it. He copies the teacher\'s habits, good and bad, from far fewer raids than the teacher has lived. A chatbot is first trained the same way on huge amounts of text, guessing every next word, and whoever picks that text shapes what it becomes.',
  },
  corrected: {
    title: 'Corrected raids',
    text: 'A teacher\'s raid never goes where his mistakes take him, so after one wrong turn he is somewhere no lesson showed. In a corrected raid he plays and the teacher says at every turn what it would do there; here that mostly makes him worse, because the teacher steers by a map it remembers and he cannot see, so he learns to guess. Chatbots are also trained on their own answers with corrections, to fix this "exposure bias", and it helps only when the corrections use what the model can see.',
  },
  pickaxe: {
    title: 'The dwarf\'s pickaxe',
    text: 'The pickaxe dwarf digs through any wall in one blow; the barbarian needs several. Copying him, the barbarian learns moves he cannot really pull off. Small chatbots are often trained on the answers of bigger ones (this is called distillation), and they can pick up confident moves without the skill behind them.',
  },
  practice: {
    title: 'Practice and the judge',
    text: 'In practice he raids alone and a judge scores each raid; actions from raids that scored well become more likely. If the judge scores the wrong thing, he learns to please the judge instead of raiding well: this is reward hacking. Chatbots are fine-tuned with scores too, from people or from other models, and their makers watch for the same trap.',
  },
  saga: {
    title: 'The skald\'s saga',
    text: 'The skald tells the raid back: some sentences really happened, some are made up but told just as confidently, and the bolder the skald, the more he makes up. When a chatbot does this it is called hallucination: invented details that sound as sure as the facts.',
  },
};
