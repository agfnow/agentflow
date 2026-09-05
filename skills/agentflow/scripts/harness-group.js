'use strict'

const define_harness = (name, ids) => {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('harness name must be non-empty')
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new TypeError(`${name} harness check ids must be non-empty strings`)
  }
  if (new Set(ids).size !== ids.length) throw new TypeError(`${name} harness check ids must be unique`)

  const check_ids = Object.freeze([...ids])

  return Object.freeze({
    name,
    check_ids,
    run(implementations) {
      return check_ids.map(id => {
        const implementation = implementations[id]
        if (typeof implementation !== 'function') throw new TypeError(`${name} harness is missing check implementation ${id}`)
        const result = implementation()
        if (result === null || typeof result !== 'object' || result.id !== id) {
          throw new TypeError(`${name} harness check ${id} returned a mismatched result`)
        }
        return result
      })
    },
  })
}

module.exports = { define_harness }
