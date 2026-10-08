const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let frame = 0;
let nextGlow = null;

document.addEventListener('pointermove', event => {
  if (motionQuery.matches || event.pointerType === 'touch') return;
  const hero = event.target.closest('.stage-hero');
  if (!hero) return;
  const bounds = hero.getBoundingClientRect();
  nextGlow = {
    hero,
    x: `${((event.clientX - bounds.left) / bounds.width) * 100}%`,
    y: `${((event.clientY - bounds.top) / bounds.height) * 100}%`
  };
  if (frame) return;
  frame = requestAnimationFrame(() => {
    nextGlow.hero.style.setProperty('--glow-x', nextGlow.x);
    nextGlow.hero.style.setProperty('--glow-y', nextGlow.y);
    nextGlow.hero.style.setProperty('--glow-opacity', '1');
    frame = 0;
  });
}, { passive: true });

document.addEventListener('pointerout', event => {
  const hero = event.target.closest('.stage-hero');
  if (hero && !hero.contains(event.relatedTarget)) {
    hero.style.setProperty('--glow-opacity', '0');
  }
});

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    entry.target.classList.toggle('motion-paused', !entry.isIntersecting);
  }
}, { threshold: 0 });

const view = document.querySelector('#view');
let lastComparisonSignature = null;
let transferNote = null;
let reviewTimer;

function playComparison() {
  if (motionQuery.matches) return;
  const story = view.querySelector('.comparison-story');
  if (!story) return;
  story.classList.remove('story-play');
  void story.offsetWidth;
  story.classList.add('story-play');
}

const watchNarrative = () => {
  observer.disconnect();
  const hero = view.querySelector('.stage-hero');
  if (hero) observer.observe(hero);
  const comparison = view.querySelector('.comparison-story');
  if (!comparison) {
    lastComparisonSignature = null;
  } else if (comparison.dataset.signature !== lastComparisonSignature) {
    lastComparisonSignature = comparison.dataset.signature;
    playComparison();
  }
};
new MutationObserver(watchNarrative).observe(view, { childList: true });
watchNarrative();

window.addEventListener('mingdan:extracted', event => {
  if (motionQuery.matches) return;
  const story = view.querySelector('.extraction-story');
  if (!story) return;
  story.classList.add('story-play');
  view.classList.add('review-arrival');
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(() => view.classList.remove('review-arrival'), 800);
  const source = event.detail.sourceRect;
  const target = view.querySelector('.req .evidence-source');
  if (!source || !target || !event.detail.sourceText) return;
  transferNote?.remove();
  const destination = target.getBoundingClientRect();
  const width = Math.min(290, Math.max(190, source.width * .6));
  const x = source.left + Math.min(source.width - width, 24);
  const y = source.top + Math.min(source.height - 50, 42);
  const endX = destination.left + Math.min(20, destination.width * .06);
  const endY = destination.top + 8;
  const note = document.createElement('div');
  note.className = 'evidence-transfer';
  note.setAttribute('aria-hidden', 'true');
  note.textContent = `“${event.detail.sourceText}”`;
  Object.assign(note.style, { left: `${x}px`, top: `${y}px`, width: `${width}px` });
  document.body.append(note);
  transferNote = note;
  const animation = note.animate([
    { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 0 },
    { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: .15 },
    { transform: `translate3d(${endX - x}px, ${endY - y}px, 0) scale(.86)`, opacity: 1, offset: .8 },
    { transform: `translate3d(${endX - x}px, ${endY - y}px, 0) scale(.82)`, opacity: 0 }
  ], { duration: 760, easing: 'cubic-bezier(.16,1,.3,1)' });
  animation.finished.finally(() => {
    note.remove();
    if (transferNote === note) transferNote = null;
  });
});

window.addEventListener('mingdan:replay-comparison', playComparison);
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('motion-paused', document.hidden);
});
