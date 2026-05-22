import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const storageBacking = new WeakMap<object, Map<string, string>>();

function getStorageBacking(storage: object): Map<string, string> {
  let backing = storageBacking.get(storage);
  if (!backing) {
    backing = new Map<string, string>();
    storageBacking.set(storage, backing);
  }
  return backing;
}

function ensureLocalStorageApi(): void {
  const storage = globalThis.localStorage as Storage | undefined;
  const hasUsableStorage =
    storage &&
    (
      typeof storage.getItem === "function" ||
      typeof storage.setItem === "function" ||
      typeof storage.removeItem === "function" ||
      typeof storage.clear === "function"
    );
  const nextStorage = (hasUsableStorage ? storage : {}) as Storage;
  const backing = getStorageBacking(nextStorage);
  const defineStorageProperty = (
    key: keyof Storage,
    descriptor: PropertyDescriptor,
  ) => {
    Object.defineProperty(nextStorage, key, {
      configurable: true,
      ...descriptor,
    });
  };

  if (typeof nextStorage.getItem !== "function") {
    defineStorageProperty("getItem", {
      value: (key: string) => {
        const normalizedKey = String(key);
        return backing.get(normalizedKey) ?? null;
      },
    });
  }

  if (typeof nextStorage.setItem !== "function") {
    defineStorageProperty("setItem", {
      value: (key: string, value: string) => {
        const normalizedKey = String(key);
        const normalizedValue = String(value);
        backing.set(normalizedKey, normalizedValue);
      },
    });
  }

  if (typeof nextStorage.removeItem !== "function") {
    defineStorageProperty("removeItem", {
      value: (key: string) => {
        const normalizedKey = String(key);
        backing.delete(normalizedKey);
      },
    });
  }

  if (typeof nextStorage.clear !== "function") {
    defineStorageProperty("clear", {
      value: () => {
        backing.clear();
      },
    });
  }

  if (typeof nextStorage.key !== "function") {
    defineStorageProperty("key", {
      value: (index: number) => {
        return Array.from(backing.keys())[index] ?? null;
      },
    });
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(nextStorage, "length");
  if (!lengthDescriptor) {
    defineStorageProperty("length", {
      get: () => backing.size,
    });
  }

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: nextStorage,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: nextStorage,
    });
  }
}

// Mock ResizeObserver for React Flow tests
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

global.ResizeObserver = ResizeObserverMock;

// Mock DOMMatrixReadOnly for React Flow
class DOMMatrixReadOnlyMock {
  m22: number = 1;
  constructor() {
    this.m22 = 1;
  }
}

global.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;

ensureLocalStorageApi();

beforeEach(() => {
  ensureLocalStorageApi();
});

// Cleanup after each test to ensure DOM is reset
afterEach(() => {
  cleanup();
});
