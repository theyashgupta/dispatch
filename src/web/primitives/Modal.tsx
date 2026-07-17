import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./IconButton.js";

export interface ModalControl {
  requestClose: () => void;
  beginImmediateClose: () => boolean;
}

let stackCounter = 0;
const modalStack: number[] = [];

interface ModalProps {
  ariaLabel: string;
  title: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  controlRef?: Ref<ModalControl>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  dialogStyle?: CSSProperties;
}

const scrimStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  transition: "opacity 150ms ease-out",
  zIndex: 20,
};

const centerStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-lg)",
  zIndex: 21,
  pointerEvents: "none",
};

const dialogBaseStyle: CSSProperties = {
  pointerEvents: "auto",
  width: "480px",
  maxWidth: "calc(100vw - 32px)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  padding: "var(--space-xl)",
  background: "var(--surface-column)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  transition: "opacity 150ms ease-out, transform 150ms ease-out",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "var(--space-lg)",
};

const headingStyle: CSSProperties = {
  margin: 0,
  minWidth: 0,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export function Modal({
  ariaLabel,
  title,
  onClose,
  footer,
  children,
  controlRef,
  initialFocusRef,
  dialogStyle,
}: ModalProps) {
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const idRef = useRef<number | undefined>(undefined);
  if (idRef.current === undefined) idRef.current = stackCounter++;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const control = useRef<ModalControl>({
    requestClose: () => {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      setTimeout(() => onCloseRef.current(), 150);
    },
    beginImmediateClose: () => {
      if (closingRef.current) return false;
      closingRef.current = true;
      return true;
    },
  });

  useImperativeHandle(controlRef, () => control.current, []);

  useEffect(() => {
    initialFocusRef?.current?.focus();
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [initialFocusRef]);

  useEffect(() => {
    modalStack.push(idRef.current!);
    return () => {
      const i = modalStack.indexOf(idRef.current!);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      control.current.requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = entered && !closing;

  return createPortal(
    <>
      <div
        onClick={() => control.current.requestClose()}
        aria-hidden="true"
        style={{ ...scrimStyle, opacity: active ? 1 : 0 }}
      />

      <div style={centerStyle}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          style={{
            ...dialogBaseStyle,
            ...dialogStyle,
            opacity: active ? 1 : 0,
            transform: active ? "scale(1)" : "scale(0.98)",
          }}
        >
          <div style={headerStyle}>
            <h2 style={headingStyle}>{title}</h2>
            <IconButton
              onClick={() => control.current.requestClose()}
              aria-label="Close"
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>

          {children}

          {footer}
        </div>
      </div>
    </>,
    document.body,
  );
}
