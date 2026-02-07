import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactElement;
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, delay = 100 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    
    // 计算 tooltip 位置（在按钮下方居中）
    setPosition({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    });

    // 延迟显示
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      {React.cloneElement(children, {
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        ref: targetRef,
      })}
      {isVisible && (
        <div
          className="fixed z-[9999] px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded shadow-lg pointer-events-none whitespace-nowrap animate-in fade-in zoom-in-95 duration-100"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            transform: 'translateX(-50%)',
          }}
        >
          {content}
          <div
            className="absolute w-2 h-2 bg-gray-900 transform rotate-45"
            style={{
              top: '-4px',
              left: '50%',
              marginLeft: '-4px',
            }}
          />
        </div>
      )}
    </>
  );
};
