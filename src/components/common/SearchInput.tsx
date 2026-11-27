/**
 * Debounced search input with clear button.
 */

import { useState, useEffect, useId, useRef, useCallback, type ChangeEvent, type Ref } from 'react';
import { Search, X } from 'lucide-react';
import styles from './SearchInput.module.css';

interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}

export function SearchInput({
  value: controlledValue,
  onChange,
  placeholder = 'Search…',
  debounceMs = 300,
  className,
  inputRef,
}: SearchInputProps) {
  const inputId = useId();
  const [localValue, setLocalValue] = useState(controlledValue ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync external value changes
  useEffect(() => {
    if (controlledValue !== undefined) {
      setLocalValue(controlledValue);
    }
  }, [controlledValue]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        onChange(newValue);
      }, debounceMs);
    },
    [onChange, debounceMs]
  );

  const handleClear = useCallback(() => {
    setLocalValue('');
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    onChange('');
  }, [onChange]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      <Search className={styles.searchIcon} size={16} aria-hidden="true" />
      <label className="sr-only" htmlFor={inputId}>
        {placeholder}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        className={styles.input}
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {localValue && (
        <button
          className={styles.clearButton}
          onClick={handleClear}
          type="button"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
