'use client';

import React from 'react';

interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.1, className = '' }: SliderProps) {
    return (
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className={`w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer ${className}`}
            style={{
                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(value / max) * 100}%, #e5e7eb ${(value / max) * 100}%, #e5e7eb 100%)`,
            }}
        />
    );
}

