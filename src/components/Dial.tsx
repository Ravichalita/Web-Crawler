import React, { useRef, useEffect, useState } from 'react';

interface DialProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  label: string;
  formatValue?: (value: number) => string | number;
}

export function Dial({ min, max, value, onChange, label, formatValue }: DialProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const percentage = (value - min) / (max - min);
  const offset = circumference * (1 - percentage);

  const handleInteraction = (clientX: number, clientY: number) => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const x = clientX - centerX;
    const y = clientY - centerY;

    let angle = Math.atan2(y, x);
    if (angle < 0) angle += 2 * Math.PI;

    let normalizedAngle = angle + (Math.PI / 2);
    if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
    if (normalizedAngle > 2 * Math.PI) normalizedAngle -= 2 * Math.PI;

    const newPercentage = normalizedAngle / (2 * Math.PI);
    const newValue = Math.round(min + newPercentage * (max - min));
    onChange(Math.max(min, Math.min(max, newValue)));
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) handleInteraction(e.clientX, e.clientY);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging) handleInteraction(e.touches[0].clientX, e.touches[0].clientY);
    };
    const handleEnd = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchend', handleEnd);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, min, max, onChange]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-[160px] h-[160px] cursor-pointer"
      onMouseDown={(e) => {
        setIsDragging(true);
        handleInteraction(e.clientX, e.clientY);
        e.preventDefault();
      }}
      onTouchStart={(e) => {
        setIsDragging(true);
        handleInteraction(e.touches[0].clientX, e.touches[0].clientY);
      }}
    >
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 overflow-visible">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#16181b" strokeWidth="12" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#00D1FF"
          strokeWidth="12"
          strokeLinecap="round"
          style={{ 
            strokeDasharray: `${circumference} ${circumference}`, 
            strokeDashoffset: offset,
            transition: isDragging ? 'none' : 'stroke-dashoffset 0.3s ease',
            filter: 'drop-shadow(0 0 6px rgba(0, 209, 255, 0.4))'
          }}
        />
        <circle 
          cx="50" 
          cy="50" 
          r="28" 
          fill="#22252A" 
          style={{ filter: 'drop-shadow(4px 4px 8px #16181b) drop-shadow(-4px -4px 8px #2e3239)' }} 
        />
      </svg>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-semibold text-white tracking-tight">{formatValue ? formatValue(value) : value}</span>
        <span className="text-[10px] text-[#8E9299] uppercase tracking-wider mt-1">{label}</span>
      </div>
    </div>
  );
}
