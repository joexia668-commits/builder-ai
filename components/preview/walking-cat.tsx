"use client";

// CSS injected once — keyframes for the walk cycle, body bob, and tail wave.
// prefers-reduced-motion: stops all animation so the indicator stays readable.
const CAT_CSS = `
  .cat-group {
    animation: cat-bob 0.45s ease-in-out infinite;
  }
  .cat-tail {
    transform-box: fill-box;
    transform-origin: 100% 100%;
    animation: cat-tail-wave 0.7s ease-in-out infinite;
  }
  .cat-leg-a {
    transform-box: fill-box;
    transform-origin: top center;
    animation: cat-leg-a 0.45s ease-in-out infinite;
  }
  .cat-leg-b {
    transform-box: fill-box;
    transform-origin: top center;
    animation: cat-leg-b 0.45s ease-in-out infinite;
  }
  @keyframes cat-bob {
    0%, 100% { transform: translateY(0px); }
    50%       { transform: translateY(-2px); }
  }
  @keyframes cat-tail-wave {
    0%, 100% { transform: rotate(0deg); }
    50%      { transform: rotate(22deg); }
  }
  @keyframes cat-leg-a {
    0%, 100% { transform: rotate(20deg); }
    50%      { transform: rotate(-20deg); }
  }
  @keyframes cat-leg-b {
    0%, 100% { transform: rotate(-20deg); }
    50%      { transform: rotate(20deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cat-group, .cat-tail, .cat-leg-a, .cat-leg-b { animation: none; }
  }
`;

export function WalkingCat() {
  return (
    <div className="flex-1 flex items-center justify-center gap-5 bg-[#1e1e1e]">
      <style dangerouslySetInnerHTML={{ __html: CAT_CSS }} />

      {/*
        Profile-view cat facing right.
        Layer order (back→front): tail → back legs → body → front legs → head
        ViewBox: 0 0 110 78  (78 = body_y 63 + leg_height 14 + 1px pad)
      */}
      <svg
        width="110"
        height="78"
        viewBox="0 0 110 78"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="正在生成..."
        role="img"
      >
        {/*
          Everything moves together (body bob).
          Tail is first child → rendered behind body.
          Back legs before body ellipse → behind body.
          Front legs after body ellipse → in front of body.
          Head last → on top.
        */}
        <g className="cat-group">
          {/* Tail — attaches at left side of body (30, 50), tip curves up-left */}
          <path
            className="cat-tail"
            d="M30 50 C16 48 10 36 18 26"
            stroke="#86efac"
            strokeWidth="4"
            strokeLinecap="round"
          />

          {/* Back legs (pair further from viewer — slightly dimmer green) */}
          <rect className="cat-leg-a" x="37" y="61" width="6" height="14" rx="3" fill="#4ade80" />
          <rect className="cat-leg-b" x="45" y="61" width="6" height="14" rx="3" fill="#4ade80" />

          {/* Body */}
          <ellipse cx="52" cy="50" rx="22" ry="13" fill="#86efac" />

          {/* Front legs (pair closer to viewer — brighter green, in front of body) */}
          <rect className="cat-leg-b" x="61" y="61" width="6" height="14" rx="3" fill="#86efac" />
          <rect className="cat-leg-a" x="69" y="61" width="6" height="14" rx="3" fill="#86efac" />

          {/* Head */}
          <circle cx="73" cy="35" r="14" fill="#86efac" />

          {/* Ears */}
          <path d="M62 27 L67 16 L73 27 Z" fill="#86efac" />
          <path d="M72 27 L77 16 L83 27 Z" fill="#86efac" />
          {/* Inner ear highlight */}
          <path d="M63.5 26 L67 19 L72 26 Z" fill="#4ade80" />
          <path d="M73 26 L77 19 L81.5 26 Z" fill="#4ade80" />

          {/* Eyes — cute closed arcs (content/sleepy expression while working) */}
          <path
            d="M74 32 Q77.5 29 81 32"
            stroke="#1a2e1a"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Nose */}
          <ellipse cx="85" cy="37" rx="2" ry="1.5" fill="#4ade80" />

          {/* Mouth */}
          <path
            d="M83 39 Q85 42 87 39"
            stroke="#1a2e1a"
            strokeWidth="1.2"
            strokeLinecap="round"
          />

          {/* Whiskers */}
          <line x1="87" y1="35" x2="105" y2="32" stroke="#86efac" strokeWidth="1" strokeOpacity="0.55" />
          <line x1="87" y1="37" x2="105" y2="37" stroke="#86efac" strokeWidth="1" strokeOpacity="0.55" />
          <line x1="87" y1="39" x2="105" y2="42" stroke="#86efac" strokeWidth="1" strokeOpacity="0.55" />
        </g>
      </svg>

      {/* Label — follows the cat */}
      <span className="font-mono text-sm text-green-400 select-none">
        等待 engineer 输出
        <span className="animate-pulse">...</span>
      </span>
    </div>
  );
}
