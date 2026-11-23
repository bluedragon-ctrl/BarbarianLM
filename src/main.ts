import './style.css';

/** App shell for now: the game's tabs arrive with the UI steps of docs/plan.md. */
const root = document.getElementById('app');
if (root) {
  root.innerHTML = `
    <header class="top">
      <h1>Barbarian LM</h1>
      <p>A barbarian raids a dungeon one predicted action at a time, the way a language model writes one word at a time.</p>
    </header>
    <main class="card"><p>Being built. Come back soon.</p></main>`;
}
