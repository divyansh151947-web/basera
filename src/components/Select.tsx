"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  clearable?: boolean;
  maxHeight?: number;
  /** Keep options with an empty value (e.g. "Any Type") visible in the list. */
  showEmptyOption?: boolean;
  /** Optional id for the trigger button, used to associate a <label>. */
  id?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  disabled = false,
  "aria-label": ariaLabel,
  clearable = false,
  maxHeight = 240,
  showEmptyOption = false,
  id,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const selectRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && optionsRef.current) {
      const highlightedOption = optionsRef.current.querySelector(
        `[data-index="${highlightedIndex}"]`
      );
      if (highlightedOption) {
        highlightedOption.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isOpen) {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setIsOpen(true);
          setHighlightedIndex(options.findIndex((o) => o.value === value) ?? 0);
        }
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlightedIndex((prev) =>
            prev < options.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : options.length - 1
          );
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < options.length) {
            onChange(options[highlightedIndex].value);
            setIsOpen(false);
            setHighlightedIndex(-1);
          }
          break;
        case "Escape":
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
        case "Tab":
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
      }
    },
    [isOpen, options, value, onChange, highlightedIndex]
  );

  const handleOptionClick = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange("");
    setIsOpen(false);
  };

  const filteredOptions = showEmptyOption
    ? options
    : options.filter((o) => o.value !== "" || o.value === value);

  return (
    <div
      ref={selectRef}
      className={`relative min-w-0 ${className}`}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        id={id}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel}: ${value ? selectedOption?.label ?? value : placeholder}` : value ? selectedOption?.label ?? value : placeholder}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`w-full flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-[var(--field)] px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 transition-colors ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <span className={`flex-1 text-left truncate ${
          value ? "text-white" : "text-white/55"
        }`} title={value ? selectedOption?.label ?? value : placeholder}>
          {value ? selectedOption?.label ?? value : placeholder}
        </span>
        {clearable && value && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 p-1 text-white/55 hover:text-white transition-colors"
            aria-label="Clear selection"
          >
            <X size={16} />
          </button>
        )}
        {isOpen ? (
          <ChevronUp size={18} className="flex-shrink-0 text-white/70" />
        ) : (
          <ChevronDown size={18} className="flex-shrink-0 text-white/70" />
        )}
      </button>

      {isOpen && (
        <div
          ref={optionsRef}
          className="absolute z-50 mt-1.5 w-full overflow-auto rounded-xl border border-white/15 bg-[var(--panel)] shadow-[0_25px_50px_rgba(0,0,0,0.5)]"
          style={{ maxHeight: `${maxHeight}px` }}
          role="listbox"
          aria-label={ariaLabel}
        >
          {filteredOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleOptionClick(option.value)}
              onMouseEnter={() => setHighlightedIndex(index)}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              title={option.label}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                option.value === value
                  ? "bg-[#d8a94e]/10 text-[#ffdf9e]"
                  : index === highlightedIndex
                  ? "bg-white/10 text-white"
                  : "text-white/80 hover:bg-white/5"
              }`}
            >
              <span className="flex-1 truncate text-left">{option.label}</span>
              {option.value === value && (
                <span className="flex-shrink-0 text-[#d8a94e]" aria-hidden>✓</span>
              )}
            </button>
          ))}
          {filteredOptions.length === 0 && (
            <div className="px-4 py-2.5 text-sm text-white/55">
              No options available
            </div>
          )}
        </div>
      )}
    </div>
  );
}