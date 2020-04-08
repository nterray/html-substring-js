import htmlTags from 'html-tags'
import voidHtmlTags from 'html-tags/void'

/**
 * List of tags having optional closing tag
 */
const optionalVoidHtmlTags = [
  'li',
]

const { min, max } = Math

class HtmlSubstringError extends Error {}

interface Options {
  breakWords: boolean
  suffix: (() => string) | string | null,
  shouldEncloseSuffixInTags: boolean
}

const DEFAULT_OPTIONS: Options = {
  breakWords: true,
  shouldEncloseSuffixInTags: false,
  suffix: null,
}

const isLetter = (input: string) => {
  return input && input.toLowerCase() !== input.toUpperCase()
}

const isNumber = (input: string) => {
  return '0123456789'.indexOf(input) !== -1
}

const isWhitespace = (input: string) => {
  return ' \t\r\n'.indexOf(input) !== -1
}

const isVoidTag = (tag: string) => voidHtmlTags.indexOf(tag) !== -1
const isOptionalVoidTag = (tag: string) => optionalVoidHtmlTags.indexOf(tag) !== -1

const haveToHaveClosingTag = (tag: string) => !(isVoidTag(tag) || isOptionalVoidTag(tag))

/**
 * @param source Source HTML
 * @param length Visible characters (everything but HTML tags) limit
 * @param options Options object
 *
 * @returns stripped source by length characters
 */
export function html_substring(
  source: string,
  length: number,
  options: string | Partial<Options> = DEFAULT_OPTIONS,
): string {
  let opts: Options
  if (typeof options === 'string') {
    opts = {
      ...DEFAULT_OPTIONS,
      suffix: options,
    }
  } else {
    opts = {
      ...DEFAULT_OPTIONS,
      ...options,
    }
  }

  let current = 0 // current text length
  let i = 0 // current source position
  const chars = Array.from(source) // Split the string to array of characters

  const openTag = (): [string, string] | null => {
    let tag = ''
    let other = ''
    let c: string = ''
    const tagStart = i

    while (i < chars.length) {
      c = chars[i++]
      if (!isLetter(c) && !isNumber(c)) {
        break
      }

      tag += c
    }

    if (tag.length > 0 && i < chars.length && c !== '>') {
      other += c

      while (i < chars.length) {
        c = chars[i++]
        if (c === '>') {
          break
        }

        other += c
      }
    }

    if (tag.length === 0 || c !== '>') {
      cw.push('<')
      i = tagStart
      return null
    }

    return [tag, other]
  }

  const closeTag = () => {
    let tag = ''
    let c
    while (i < chars.length) {
      c = chars[i++]
      if (c === '>') {
        break
      }

      tag += c
    }

    return tag
  }

  let c: string // current character
  const openedQueue: Array<[string, string]> = [] // nonflushed open tags
  const closeQueue: string[] = [] // list of tags to be closed
  let result: string = ''
  let suffixAdded = false

  const openTags = (onlyVoid: boolean = false) => {
    while (true) {
      const value = openedQueue.shift()
      if (!value) {
        break
      }

      const [tag, other] = value

      const isVoid = isVoidTag(tag)
      const isOptionalVoid = isOptionalVoidTag(tag)
      const isXHTMLClosed = other[other.length - 1] === '/'
      if (onlyVoid && !(isVoid || isXHTMLClosed)) {
        openedQueue.unshift([tag, other])
        break
      }

      result += '<'
      result += tag
      result += other
      result += '>'

      if (!(isVoid || isOptionalVoid || isXHTMLClosed)) {
        closeQueue.push(`</${tag}>`)
      }
    }
  }

  const getResultWithSuffixAfterClosingTags = (result: string, closeQueue: string[], flushed: boolean): string => {
    const resultWithoutSuffix = [result, ...closeQueue].join('')

    return flushed ? resultWithoutSuffix : addSuffix(resultWithoutSuffix)
  }

  const getResultWithSuffixBeforeClosingTags = (result: string, closeQueue: string[], flushed: boolean): string => {
    const resultWithSuffix = flushed ? result : addSuffix(result)

    return [resultWithSuffix, ...closeQueue].join('')
  }

  const addSuffix = (result: string): string => {
    let suffix = opts.suffix
    if (!suffixAdded && suffix !== null) {
      if (typeof suffix === 'function') {
        suffix = suffix()
      }

      suffixAdded = true

      return result + suffix
    }

    return result
  }

  const cw: string[] = [] // current word
  let cwEmpty = true
  const flushWord = opts.breakWords
    ? () => {
        if (cw.length === 0) {
          return true
        }

        const addable = max(min(length - current, cw.length), 0)
        if (addable === 0) {
          return false
        }

        openTags()

        result += cw.slice(0, addable).join('')
        current += addable
        cw.splice(0, addable)

        return true
      }
    : () => {
        if (cw.length === 0) {
          return true
        }

        if (current + cw.length <= length) {
          openTags()

          result += cw.join('')
          current += cw.length
          cw.length = 0

          return true
        }

        return false
      }

  mainloop: while (current < length && i < chars.length) {
    c = chars[i++]

    switch (c) {
      case '<':
        if (!flushWord()) {
          break mainloop
        }

        // there's tag
        switch (chars[i]) {
          case '!': {
            if (chars[i + 1] === '-' && chars[i + 2] === '-') {
              // comment
              i += 2
              while (
                chars[i] !== '-' &&
                chars[i + 1] !== '-' &&
                chars[i + 2] !== '>'
              ) {
                ++current
                result += chars[i++]
              }
              i += 2
            } else {
              ++current
              result += '<'
            }
            break
          }
          case '/': {
            // We should flush opened tags queue since we are going to close a tag just now
            openTags()

            const offset = i - 1
            ++i
            const tag = closeTag()
            let success = false

            // if the tag doesn't need to be closed, then just print it
            if (haveToHaveClosingTag(tag)) {
              while (closeQueue.length !== 0) {
                success = closeQueue.pop() === (`</${tag}>`)
                if (success) {
                  break
                }
              }

              if (!success) {
                throw new HtmlSubstringError(
                  `Unexpected closing tag '${tag}' on offset ${offset}`,
                )
              }
            }

            if (current >= length && opts.shouldEncloseSuffixInTags) {
              result = addSuffix(result)
            }

            result += '</'
            result += tag
            result += '>'
            break
          }
          default: {
            // open tag
            const tag = openTag()
            if (tag !== null) {
              openedQueue.push(tag)
            }
            break
          }
        }
        break

      case '&':
        const offset = i - 1
        result += '&'
        ++current

        while (i < chars.length) {
          const c = chars[i++]
          // result += c

          if (isWhitespace(c)) {
            i = offset + 1
            break
          }

          if (c === ';') {
            result += chars.slice(offset + 1, i).join('')
            break
          }
        }
        break

      default:
        if (!isLetter(c) && !cwEmpty) {
          cwEmpty = true
          if (!flushWord()) {
            break mainloop
          }
        }

        if (!isWhitespace(c)) {
          cwEmpty = false
        }
        cw.push(c)
    }
  }

  openTags(true)
  const flushed = flushWord()

  closeQueue.reverse()

  if (opts.shouldEncloseSuffixInTags) {
    return getResultWithSuffixBeforeClosingTags(result, closeQueue, flushed)
  }

  return getResultWithSuffixAfterClosingTags(result, closeQueue, flushed)
}

export default html_substring
