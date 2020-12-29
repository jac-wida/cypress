import fs from './fs'
import { Visitor, builders as b, namedTypes as n, visit } from 'ast-types'
import * as recast from 'recast'
import { parse } from '@babel/parser'

export interface Command {
  selector?: string
  name: string
  message?: string
}

export interface FileDetails {
  absoluteFile: string
  column: number
  line: number
}

export const generateCypressCommand = (cmd: Command) => {
  const { selector, name, message } = cmd

  if (selector) {
    return b.expressionStatement(
      b.callExpression(
        b.memberExpression(
          b.callExpression(
            b.memberExpression(
              b.identifier('cy'),
              b.identifier('get'),
              false,
            ),
            [b.stringLiteral(selector)],
          ),
          b.identifier(name),
        ),
        message ? [b.stringLiteral(message)] : [],
      ),
    )
  }

  return b.expressionStatement(
    b.callExpression(
      b.memberExpression(
        b.identifier('cy'),
        b.identifier(name),
        false,
      ),
      message ? [b.stringLiteral(message)] : [],
    ),
  )
}

export const generateTest = (name: string, body: n.BlockStatement) => {
  return b.expressionStatement(
    b.callExpression(
      b.identifier('it'),
      [
        b.stringLiteral(name),
        b.functionExpression(
          null,
          [],
          body,
        ),
      ],
    ),
  )
}

export const addCommentToBody = (body: Array<{}>, comment: string) => {
  const block = b.block(comment, false, true)
  const stmt = b.emptyStatement()

  stmt.comments = [block]

  body.push(stmt)

  return body
}

export const addCommandsToBody = (body: Array<{}>, commands: Command[]) => {
  addCommentToBody(body, ' ==== Generated with Cypress Studio ==== ')

  commands.forEach((command) => {
    body.push(generateCypressCommand(command))
  })

  addCommentToBody(body, ' ==== End Cypress Studio ==== ')

  return body
}

export const generateAstRules = (fileDetails: { line: number, column: number }, fnNames: string[], cb: (fn: n.FunctionExpression) => any): Visitor<{}> => {
  const { line, column } = fileDetails

  return {
    visitCallExpression (path) {
      const { node } = path
      const { callee } = node

      let identifier

      if (callee.type === 'Identifier') {
        identifier = callee
      } else if (callee.type === 'MemberExpression') {
        identifier = callee.object
      }

      if (identifier) {
        const columnStart = identifier.loc.start.column + 1
        const columnEnd = identifier.loc.end.column + 2

        if (fnNames.includes(identifier.name) && identifier.loc.start.line === line && columnStart <= column && column <= columnEnd) {
          const fn = node.arguments[1] as n.FunctionExpression

          if (!fn) {
            return false
          }

          cb(fn)

          return false
        }
      }

      return this.traverse(path)
    },
  }
}

export const appendCommandsToTest = (fileDetails: FileDetails, commands: Command[]) => {
  const { absoluteFile } = fileDetails

  const astRules = generateAstRules(fileDetails, ['it', 'specify'], (fn: n.FunctionExpression) => {
    addCommandsToBody(fn.body.body, commands)
  })

  return rewriteSpec(absoluteFile, astRules)
}

export const createNewTestInSuite = (fileDetails: FileDetails, commands: Command[], testName: string) => {
  const { absoluteFile } = fileDetails

  const astRules = generateAstRules(fileDetails, ['context', 'describe'], (fn: n.FunctionExpression) => {
    const testBody = b.blockStatement([])

    addCommandsToBody(testBody.body, commands)

    const test = generateTest(testName, testBody)

    fn.body.body.push(test)
  })

  return rewriteSpec(absoluteFile, astRules)
}

export const rewriteSpec = (path: string, astRules: Visitor<{}>) => {
  return fs.readFile(path)
  .then((contents) => {
    const ast = recast.parse(contents, {
      wrapColumn: 180,
      parser: {
        parse (source) {
          return parse(source, {
            // @ts-ignore - this option works but wasn't added to the type defs
            errorRecovery: true,
            sourceType: 'unambiguous',
            plugins: [
              'typescript',
            ],
          })
        },
      },
    })

    visit(ast, astRules)

    const { code } = recast.print(ast)

    return fs.writeFile(path, code)
  })
}
