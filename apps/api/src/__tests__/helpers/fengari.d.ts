/**
 * The slice of fengari (a Lua 5.3 VM in JavaScript) the Lua test harness uses.
 * The package ships no types of its own.
 */
declare module 'fengari' {
  type LuaState = object;
  export const lua: {
    LUA_OK: number;
    lua_pcall(L: LuaState, nargs: number, nresults: number, msgh: number): number;
    lua_getglobal(L: LuaState, name: Uint8Array): number;
    lua_tojsstring(L: LuaState, index: number): string;
    lua_pop(L: LuaState, n: number): void;
  };
  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_loadbuffer(L: LuaState, code: Uint8Array, size: number | null, name: Uint8Array): number;
  };
  export const lualib: { luaL_openlibs(L: LuaState): void };
  export function to_luastring(value: string): Uint8Array;
}
