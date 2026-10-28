import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import styles from './DropdownSelect.module.css';

export interface DropdownSelectOption {
  value: string;
  label: string;
}

interface DropdownSelectProps {
  value: string;
  options: DropdownSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

interface MenuPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  opensUp: boolean;
}

const MENU_MAX_HEIGHT = 280;
const MENU_ITEM_HEIGHT = 38;

export function DropdownSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: DropdownSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusSelectedAfterOpen = useRef(false);
  const menuId = useId();
  const selectedOption = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.max(0, Math.min(Math.max(rect.width, 200), viewportWidth - 16));
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    const desiredHeight = Math.min(MENU_MAX_HEIGHT, options.length * MENU_ITEM_HEIGHT + 8);
    const roomBelow = Math.max(0, viewportHeight - rect.bottom - 8);
    const roomAbove = Math.max(0, rect.top - 8);
    const opensUp = roomBelow < desiredHeight && roomAbove > roomBelow;
    const availableSpace = opensUp ? roomAbove : roomBelow;
    const maxHeight = Math.min(desiredHeight, Math.max(80, availableSpace));

    setMenuPosition({
      left,
      width,
      maxHeight,
      top: opensUp ? undefined : rect.bottom + 6,
      bottom: opensUp ? viewportHeight - rect.top + 6 : undefined,
      opensUp,
    });
  }, [options.length]);

  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const safeIndex = (index + options.length) % options.length;
    optionRefs.current[safeIndex]?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleViewportChange = () => updateMenuPosition();

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen || !focusSelectedAfterOpen.current) return;
    optionRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus();
    focusSelectedAfterOpen.current = false;
  }, [isOpen, selectedIndex]);

  const openWithKeyboard = () => {
    focusSelectedAfterOpen.current = true;
    updateMenuPosition();
    setIsOpen(true);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openWithKeyboard();
      else focusOption(selectedIndex >= 0 ? selectedIndex : 0);
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(options.length - 1);
    }
  };

  const menu = menuPosition && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={`${styles.menu} ${isOpen ? styles.menuOpen : ''} ${menuPosition.opensUp ? styles.menuOpensUp : ''}`}
          style={{
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
            top: menuPosition.top,
            bottom: menuPosition.bottom,
          }}
          role="listbox"
          aria-label={ariaLabel}
          aria-hidden={!isOpen}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              className={`${styles.option} ${value === option.value ? styles.optionSelected : ''}`}
              type="button"
              role="option"
              aria-selected={value === option.value}
              tabIndex={-1}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span>{option.label}</span>
              {value === option.value && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div ref={rootRef} className={`${styles.root} ${className ?? ''}`}>
        <button
          ref={triggerRef}
          className={styles.trigger}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={menuId}
          onClick={() => {
            if (isOpen) setIsOpen(false);
            else {
              updateMenuPosition();
              setIsOpen(true);
            }
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className={styles.value}>{selectedOption?.label ?? value}</span>
          <ChevronDown className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} size={16} aria-hidden="true" />
        </button>
      </div>
      {menu}
    </>
  );
}
