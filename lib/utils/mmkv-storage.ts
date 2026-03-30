import { createMMKV } from 'react-native-mmkv'

// Initialize MMKV storage
const storage = createMMKV()

// MMKV storage adapter for Zustand
const mmkvStorage = {
  setItem: (name: string, value: string) => {
    return storage.set(name, value)
  },
  getItem: (name: string) => {
    const value = storage.getString(name)
    return value ?? null
  },
  removeItem: (name: string) => {
    return storage.remove(name)
  },
}

export default mmkvStorage
