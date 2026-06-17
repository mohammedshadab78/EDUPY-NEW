// ======================= E D U P Y  L A N G  v2.0 =======================
// Fully Python-like syntax: indentation based, no { }, no ;
// MAJOR UPGRADES:
//   - Float numbers, ** power op, // floor div
//   - f-strings, triple-quoted strings
//   - Augmented assignments +=, -=, *=, /=, //=, **=, %=
//   - Tuple unpacking: a, b = 1, 2
//   - Chained comparisons: 1 < x < 10
//   - Subscript assignment: arr[0] = x, dict["k"] = v
//   - lambda expressions
//   - global, pass, assert, raise, del statements
//   - None, True, False as keywords
//   - is, is not operators
//   - Walrus operator :=
//   - Comprehensive builtins: enumerate, zip, map, filter, sorted, reversed, sum, max, min, abs, round, type, isinstance, list, tuple, set, bool, chr, ord, hex, bin, oct, id
//   - Full string methods: strip, lstrip, rstrip, startswith, endswith, join, find, count, format, zfill, center, ljust, rjust, title, capitalize, swapcase, expandtabs
//   - Full list methods: pop, insert, remove, sort, index, count, extend, copy, clear, reverse
//   - Full dict methods: keys, values, items, get, update, pop, setdefault, clear, copy
//   - class definitions (basic OOP with __init__, self)
//   - multi-line with \ continuation
// =======================================================================

// ==================== LEXER WITH INDENT/DEDENT ====================

function tokenize(input) {
  const tokens = [];

  const isDigit = (ch) => /[0-9]/.test(ch);
  const isAlpha = (ch) => /[a-zA-Z_]/.test(ch);
  const isAlnum = (ch) => /[a-zA-Z0-9_]/.test(ch);

  // Normalize newlines
  let src = input.replace(/\r\n?/g, "\n");

  // Handle line continuation with backslash
  src = src.replace(/\\\n/g, " ");

  // Handle triple-quoted strings by replacing newlines inside with \n placeholder
  // We'll handle this in per-character scanning instead
  const lines = src.split("\n");
  const indentStack = [0];

  // First pass: merge triple-quoted strings across lines
  const mergedLines = [];
  let inTriple = false;
  let tripleChar = "";
  let mergedBuffer = "";
  let mergedIndent = "";

  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li];
    if (!inTriple) {
      // Check if this line opens a triple quote
      // We need to detect """ or '''
      const tripleDoubleIdx = rawLine.indexOf('"""');
      const tripleSingleIdx = rawLine.indexOf("'''");
      let openIdx = -1;
      let openChar = "";
      if (tripleDoubleIdx !== -1 && (tripleSingleIdx === -1 || tripleDoubleIdx < tripleSingleIdx)) {
        openIdx = tripleDoubleIdx;
        openChar = '"""';
      } else if (tripleSingleIdx !== -1) {
        openIdx = tripleSingleIdx;
        openChar = "'''";
      }

      if (openIdx !== -1) {
        // Check if it closes on same line
        const closeIdx = rawLine.indexOf(openChar, openIdx + 3);
        if (closeIdx !== -1) {
          // same line triple string - fine, pass through
          mergedLines.push(rawLine);
        } else {
          inTriple = true;
          tripleChar = openChar;
          mergedBuffer = rawLine + "\\n";
        }
      } else {
        mergedLines.push(rawLine);
      }
    } else {
      const closeIdx = rawLine.indexOf(tripleChar);
      if (closeIdx !== -1) {
        mergedBuffer += rawLine;
        mergedLines.push(mergedBuffer);
        mergedBuffer = "";
        inTriple = false;
        tripleChar = "";
      } else {
        mergedBuffer += rawLine + "\\n";
      }
    }
  }
  if (inTriple) {
    mergedLines.push(mergedBuffer); // unterminated, let parser catch it
  }

  for (let lineNo = 0; lineNo < mergedLines.length; lineNo++) {
    const rawLine = mergedLines[lineNo];

    // Compute indentation
    let i = 0;
    let indent = 0;
    while (i < rawLine.length) {
      const ch = rawLine[i];
      if (ch === " ") { indent += 1; }
      else if (ch === "\t") { indent += 4; }
      else break;
      i++;
    }

    const line = rawLine.slice(i);

    // Empty or comment-only lines
    if (line.trim() === "" || line.trim().startsWith("#")) {
      tokens.push({ type: "NEWLINE" });
      continue;
    }

    // Handle INDENT / DEDENT
    const prevIndent = indentStack[indentStack.length - 1];
    if (indent > prevIndent) {
      indentStack.push(indent);
      tokens.push({ type: "INDENT" });
    } else if (indent < prevIndent) {
      while (indent < indentStack[indentStack.length - 1]) {
        indentStack.pop();
        tokens.push({ type: "DEDENT" });
      }
      if (indent !== indentStack[indentStack.length - 1]) {
        throw new Error("IndentationError: inconsistent indentation on line " + (lineNo + 1));
      }
    }

    // Tokenize the line
    let j = 0;
    while (j < line.length) {
      let ch = line[j];

      if (ch === "#") break; // comment

      if (ch === " " || ch === "\t") { j++; continue; }

      // Triple-quoted strings
      if ((ch === '"' || ch === "'") && line.slice(j, j+3) === ch.repeat(3)) {
        const tripleQ = ch.repeat(3);
        j += 3;
        let str = "";
        while (j < line.length) {
          if (line.slice(j, j+3) === tripleQ) {
            j += 3;
            break;
          }
          if (line[j] === '\\' && j+1 < line.length) {
            const nx = line[j+1];
            if (nx === 'n') str += "\n";
            else if (nx === 't') str += "\t";
            else if (nx === '\\') str += "\\";
            else str += nx;
            j += 2;
          } else {
            str += line[j++];
          }
        }
        tokens.push({ type: "STRING", value: str });
        continue;
      }

      // f-strings: f"..." or f'...'
      if (ch === 'f' && j+1 < line.length && (line[j+1] === '"' || line[j+1] === "'")) {
        const quote = line[j+1];
        j += 2;
        let raw = "";
        while (j < line.length && line[j] !== quote) {
          if (line[j] === '\\' && j+1 < line.length) {
            const nx = line[j+1];
            if (nx === 'n') raw += "\n";
            else if (nx === 't') raw += "\t";
            else if (nx === quote) raw += quote;
            else if (nx === '\\') raw += "\\";
            else raw += nx;
            j += 2;
          } else {
            raw += line[j++];
          }
        }
        if (line[j] === quote) j++;
        tokens.push({ type: "FSTRING", value: raw });
        continue;
      }

      // Regular string literals
      if (ch === '"' || ch === "'") {
        const quote = ch;
        j++;
        let str = "";
        while (j < line.length && line[j] !== quote) {
          if (line[j] === "\\" && j + 1 < line.length) {
            const next = line[j + 1];
            if (next === "n") str += "\n";
            else if (next === "t") str += "\t";
            else if (next === quote) str += quote;
            else if (next === "\\") str += "\\";
            else str += next;
            j += 2;
          } else {
            str += line[j++];
          }
        }
        if (line[j] !== quote) {
          throw new Error("SyntaxError: unterminated string on line " + (lineNo + 1));
        }
        j++;
        tokens.push({ type: "STRING", value: str });
        continue;
      }

      // Numbers: int or float
      if (isDigit(ch) || (ch === '.' && j+1 < line.length && isDigit(line[j+1]))) {
        let numStr = "";
        while (j < line.length && isDigit(line[j])) numStr += line[j++];
        if (j < line.length && line[j] === '.' && j+1 < line.length && isDigit(line[j+1])) {
          numStr += line[j++];
          while (j < line.length && isDigit(line[j])) numStr += line[j++];
        }
        // scientific notation
        if (j < line.length && (line[j] === 'e' || line[j] === 'E')) {
          numStr += line[j++];
          if (j < line.length && (line[j] === '+' || line[j] === '-')) numStr += line[j++];
          while (j < line.length && isDigit(line[j])) numStr += line[j++];
        }
        tokens.push({ type: "NUMBER", value: Number(numStr) });
        continue;
      }

      // Identifiers / Keywords
      if (isAlpha(ch)) {
        let ident = "";
        while (j < line.length && isAlnum(line[j])) ident += line[j++];

        if (ident === "True") { tokens.push({ type: "BOOLEAN", value: true }); continue; }
        if (ident === "False") { tokens.push({ type: "BOOLEAN", value: false }); continue; }
        if (ident === "None") { tokens.push({ type: "NONE" }); continue; }

        const keywords = [
          "if", "elif", "else", "while", "for", "in", "def", "return",
          "try", "except", "finally", "import", "from", "as",
          "and", "or", "not", "is",
          "break", "continue", "pass", "global", "nonlocal",
          "lambda", "assert", "raise", "del", "class", "with", "yield",
        ];

        if (keywords.includes(ident)) {
          tokens.push({ type: "KEYWORD", value: ident });
        } else {
          tokens.push({ type: "IDENT", value: ident });
        }
        continue;
      }

      // Walrus operator :=
      if (ch === ':' && j+1 < line.length && line[j+1] === '=') {
        tokens.push({ type: "WALRUS" });
        j += 2;
        continue;
      }

      // Multi-char operators (order matters - longer first)
      const threeChars = line.slice(j, j + 3);
      if (threeChars === "**=") { tokens.push({ type: "STARSTAR_ASSIGN" }); j += 3; continue; }
      if (threeChars === "//=") { tokens.push({ type: "DOUBLESLASH_ASSIGN" }); j += 3; continue; }

      const twoChars = line.slice(j, j + 2);
      if (twoChars === "**") { tokens.push({ type: "STARSTAR" }); j += 2; continue; }
      if (twoChars === "//") { tokens.push({ type: "DOUBLESLASH" }); j += 2; continue; }
      if (twoChars === "==") { tokens.push({ type: "EQEQ", value: "==" }); j += 2; continue; }
      if (twoChars === "!=") { tokens.push({ type: "NOTEQ", value: "!=" }); j += 2; continue; }
      if (twoChars === "<=") { tokens.push({ type: "LTE", value: "<=" }); j += 2; continue; }
      if (twoChars === ">=") { tokens.push({ type: "GTE", value: ">=" }); j += 2; continue; }
      if (twoChars === "+=") { tokens.push({ type: "PLUS_ASSIGN" }); j += 2; continue; }
      if (twoChars === "-=") { tokens.push({ type: "MINUS_ASSIGN" }); j += 2; continue; }
      if (twoChars === "*=") { tokens.push({ type: "STAR_ASSIGN" }); j += 2; continue; }
      if (twoChars === "/=") { tokens.push({ type: "SLASH_ASSIGN" }); j += 2; continue; }
      if (twoChars === "%=") { tokens.push({ type: "PERCENT_ASSIGN" }); j += 2; continue; }
      if (twoChars === "->") { tokens.push({ type: "ARROW" }); j += 2; continue; }

      // Single-char tokens
      switch (ch) {
        case "{": tokens.push({ type: "LBRACE" }); j++; continue;
        case "}": tokens.push({ type: "RBRACE" }); j++; continue;
        case "+": tokens.push({ type: "PLUS" }); j++; continue;
        case "-": tokens.push({ type: "MINUS" }); j++; continue;
        case "*": tokens.push({ type: "STAR" }); j++; continue;
        case "/": tokens.push({ type: "SLASH" }); j++; continue;
        case "%": tokens.push({ type: "PERCENT" }); j++; continue;
        case "(": tokens.push({ type: "LPAREN" }); j++; continue;
        case ")": tokens.push({ type: "RPAREN" }); j++; continue;
        case "[": tokens.push({ type: "LBRACKET" }); j++; continue;
        case "]": tokens.push({ type: "RBRACKET" }); j++; continue;
        case "=": tokens.push({ type: "EQUAL" }); j++; continue;
        case "<": tokens.push({ type: "LT", value: "<" }); j++; continue;
        case ">": tokens.push({ type: "GT", value: ">" }); j++; continue;
        case ",": tokens.push({ type: "COMMA" }); j++; continue;
        case ".": tokens.push({ type: "DOT" }); j++; continue;
        case ":": tokens.push({ type: "COLON" }); j++; continue;
        case ";": tokens.push({ type: "NEWLINE" }); j++; continue; // treat ; as newline
        case "~": tokens.push({ type: "TILDE" }); j++; continue;
        case "@": tokens.push({ type: "AT" }); j++; continue;
        case "^": tokens.push({ type: "CARET" }); j++; continue;
        case "&": tokens.push({ type: "AMPERSAND" }); j++; continue;
        case "|": tokens.push({ type: "PIPE" }); j++; continue;
      }

      throw new Error("SyntaxError: unexpected character '" + ch + "' on line " + (lineNo + 1));
    }

    tokens.push({ type: "NEWLINE" });
  }

  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: "DEDENT" });
  }

  tokens.push({ type: "EOF" });
  return tokens;
}

// ========================== PARSER ==========================

function createParser(tokens) {
  let current = 0;

  function peek(offset = 0) { return tokens[current + offset]; }
  function advance() { return tokens[current++]; }
  function check(type) { return peek().type === type; }
  function checkVal(type, value) { return peek().type === type && peek().value === value; }

  function match(...types) {
    for (const t of types) {
      if (check(t)) { advance(); return true; }
    }
    return false;
  }

  function expect(type, message) {
    if (check(type)) return advance();
    throw new Error("SyntaxError: " + message + " (got: " + peek().type + " '" + (peek().value || "") + "')");
  }

  function matchKeyword(value) {
    if (peek().type === "KEYWORD" && peek().value === value) { advance(); return true; }
    return false;
  }

  function expectKeyword(value, message) {
    if (peek().type === "KEYWORD" && peek().value === value) return advance();
    throw new Error("SyntaxError: " + message + " (got: " + peek().type + " '" + (peek().value || "") + "')");
  }

  function skipNewlines() {
    while (match("NEWLINE")) { /* skip */ }
  }

  // ---- Program ----
  function parseProgram() {
    const body = [];
    skipNewlines();
    while (!check("EOF")) {
      body.push(parseStatement());
      skipNewlines();
    }
    return { type: "Program", body };
  }

  // ---- Statements ----
  function parseStatement() {
    const tok = peek();

    if (tok.type === "KEYWORD") {
      switch (tok.value) {
        case "def": return parseFunctionDeclaration();
        case "class": return parseClassDeclaration();
        case "if": return parseIfStatement();
        case "while": return parseWhileStatement();
        case "for": return parseForStatement();
        case "try": return parseTryStatement();
        case "return": return parseReturnStatement();
        case "import": return parseImportStatement();
        case "from": return parseFromImportStatement();
        case "break": advance(); return { type: "BreakStatement" };
        case "continue": advance(); return { type: "ContinueStatement" };
        case "pass": advance(); return { type: "PassStatement" };
        case "global": return parseGlobalStatement();
        case "nonlocal": return parseNonlocalStatement();
        case "assert": return parseAssertStatement();
        case "raise": return parseRaiseStatement();
        case "del": return parseDelStatement();
        case "lambda": return parseExpressionStatement(); // lambda as expression-statement
      }
    }

    // Tuple unpacking: a, b = ...
    if (check("IDENT") && peek(1).type === "COMMA") {
      return parseTupleUnpackStatement();
    }

    // Subscript / attribute assignment: x[i] = ..., x.attr = ...
    if (check("IDENT")) {
      // Look ahead to detect assignment forms
      const saved = current;
      const target = parseLHSTarget();
      if (target !== null) {
        // Augmented or regular assignment
        const augOps = {
          "PLUS_ASSIGN": "+=", "MINUS_ASSIGN": "-=", "STAR_ASSIGN": "*=",
          "SLASH_ASSIGN": "/=", "PERCENT_ASSIGN": "%=",
          "STARSTAR_ASSIGN": "**=", "DOUBLESLASH_ASSIGN": "//=",
        };
        if (check("EQUAL")) {
          advance();
          const value = parseExpression();
          return { type: "AssignmentStatement", target, value };
        }
        for (const [tokType, op] of Object.entries(augOps)) {
          if (check(tokType)) {
            advance();
            const rhs = parseExpression();
            return { type: "AugmentedAssignment", target, operator: op, value: rhs };
          }
        }
        // not an assignment — reset and treat as expression
        current = saved;
      } else {
        current = saved;
      }
    }

    return parseExpressionStatement();
  }

  // Try to parse an LHS target (Identifier, subscript, attribute chain)
  // Returns target node or null if not a valid LHS
  function parseLHSTarget() {
    if (!check("IDENT")) return null;
    const nameTok = advance(); // consume ident
    let expr = { type: "Identifier", name: nameTok.value };

    // chains: .attr, [idx]
    while (true) {
      if (check("DOT") && peek(1).type === "IDENT") {
        advance(); // .
        const prop = advance(); // ident
        expr = { type: "PropertyAccess", object: expr, property: prop.value };
      } else if (check("LBRACKET")) {
        advance();
        if (check("RBRACKET")) { current--; break; } // empty bracket not valid here
        const idx = parseExpression();
        if (!check("RBRACKET")) { return null; } // not closing - bail
        advance();
        expr = { type: "IndexExpression", array: expr, index: idx };
      } else {
        break;
      }
    }

    // Now check: next token should be an assignment operator
    const assignOps = ["EQUAL","PLUS_ASSIGN","MINUS_ASSIGN","STAR_ASSIGN","SLASH_ASSIGN","PERCENT_ASSIGN","STARSTAR_ASSIGN","DOUBLESLASH_ASSIGN"];
    if (!assignOps.includes(peek().type)) return null;
    return expr;
  }

  function parseTupleUnpackStatement() {
    const targets = [];
    targets.push(expect("IDENT", "Expected identifier").value);
    while (match("COMMA")) {
      if (check("IDENT")) targets.push(advance().value);
    }
    expect("EQUAL", "Expected '=' in tuple unpack");
    const value = parseExpression();
    return { type: "TupleUnpackStatement", targets, value };
  }

  function parseFunctionDeclaration() {
    expectKeyword("def", "Expected 'def'");
    const nameTok = expect("IDENT", "Expected function name");
    expect("LPAREN", "Expected '(' after function name");
    const params = [];
    const defaults = {};
    let hasVarargs = false;
    let varargsName = null;
    let hasKwargs = false;
    let kwargsName = null;

    if (!check("RPAREN")) {
      do {
        if (match("STAR")) {
          if (match("STAR")) {
            kwargsName = expect("IDENT", "Expected **kwargs name").value;
            hasKwargs = true;
          } else {
            varargsName = expect("IDENT", "Expected *args name").value;
            hasVarargs = true;
          }
        } else {
          const p = expect("IDENT", "Expected parameter name");
          params.push(p.value);
          if (match("EQUAL")) {
            defaults[p.value] = parseExpression();
          }
        }
      } while (match("COMMA") && !check("RPAREN"));
    }
    expect("RPAREN", "Expected ')' after parameters");
    // optional return type annotation
    if (match("ARROW")) parseExpression(); // ignore annotation
    expect("COLON", "Expected ':' after function header");
    expect("NEWLINE", "Expected newline after function header");
    const body = parseIndentedBlock();

    return {
      type: "FunctionDeclaration",
      name: nameTok.value,
      params,
      defaults,
      hasVarargs,
      varargsName,
      hasKwargs,
      kwargsName,
      body,
    };
  }

  function parseClassDeclaration() {
    expectKeyword("class", "Expected 'class'");
    const nameTok = expect("IDENT", "Expected class name");
    let baseClass = null;
    if (match("LPAREN")) {
      if (check("IDENT")) baseClass = advance().value;
      expect("RPAREN", "Expected ')' after base class");
    }
    expect("COLON", "Expected ':' after class name");
    expect("NEWLINE", "Expected newline after class definition");
    const body = parseIndentedBlock();
    return { type: "ClassDeclaration", name: nameTok.value, baseClass, body };
  }

  function parseReturnStatement() {
    expectKeyword("return", "Expected 'return'");
    // return with no value
    if (check("NEWLINE") || check("EOF") || check("DEDENT")) {
      return { type: "ReturnStatement", argument: { type: "NullLiteral" } };
    }
    const argument = parseExpression();
    return { type: "ReturnStatement", argument };
  }

  function parseGlobalStatement() {
    expectKeyword("global", "Expected 'global'");
    const names = [expect("IDENT", "Expected identifier").value];
    while (match("COMMA")) names.push(expect("IDENT", "Expected identifier").value);
    return { type: "GlobalStatement", names };
  }

  function parseNonlocalStatement() {
    expectKeyword("nonlocal", "Expected 'nonlocal'");
    const names = [expect("IDENT", "Expected identifier").value];
    while (match("COMMA")) names.push(expect("IDENT", "Expected identifier").value);
    return { type: "GlobalStatement", names }; // treat same as global for simplicity
  }

  function parseAssertStatement() {
    expectKeyword("assert", "Expected 'assert'");
    const test = parseExpression();
    let msg = null;
    if (match("COMMA")) msg = parseExpression();
    return { type: "AssertStatement", test, msg };
  }

  function parseRaiseStatement() {
    expectKeyword("raise", "Expected 'raise'");
    if (check("NEWLINE") || check("EOF")) return { type: "RaiseStatement", expression: null };
    const expression = parseExpression();
    return { type: "RaiseStatement", expression };
  }

  function parseDelStatement() {
    expectKeyword("del", "Expected 'del'");
    const target = parseExpression();
    return { type: "DelStatement", target };
  }

  function parseIfStatement() {
    expectKeyword("if", "Expected 'if'");
    const test = parseExpression();
    expect("COLON", "Expected ':' after if condition");
    expect("NEWLINE", "Expected newline after if condition");
    const consequent = parseIndentedBlock();

    const elifBranches = [];
    while (peek().type === "KEYWORD" && peek().value === "elif") {
      advance();
      const eTest = parseExpression();
      expect("COLON", "Expected ':' after elif");
      expect("NEWLINE", "Expected newline after elif");
      const eBody = parseIndentedBlock();
      elifBranches.push({ test: eTest, body: eBody });
    }

    let alternate = null;
    if (peek().type === "KEYWORD" && peek().value === "else") {
      advance();
      expect("COLON", "Expected ':' after else");
      expect("NEWLINE", "Expected newline after else");
      alternate = parseIndentedBlock();
    }

    for (let i = elifBranches.length - 1; i >= 0; i--) {
      const br = elifBranches[i];
      alternate = { type: "IfStatement", test: br.test, consequent: br.body, alternate };
    }

    return { type: "IfStatement", test, consequent, alternate };
  }

  function parseWhileStatement() {
    expectKeyword("while", "Expected 'while'");
    const test = parseExpression();
    expect("COLON", "Expected ':' after while");
    expect("NEWLINE", "Expected newline after while");
    const body = parseIndentedBlock();
    let elseBlock = null;
    if (peek().type === "KEYWORD" && peek().value === "else") {
      advance();
      expect("COLON", "Expected ':' after else");
      expect("NEWLINE", "Expected newline after else");
      elseBlock = parseIndentedBlock();
    }
    return { type: "WhileStatement", test, body, elseBlock };
  }

  function parseForStatement() {
    expectKeyword("for", "Expected 'for'");

    // Support tuple unpacking: for a, b in ...
    const iterVars = [expect("IDENT", "Expected loop variable").value];
    while (match("COMMA")) {
      if (check("IDENT")) iterVars.push(advance().value);
    }

    expectKeyword("in", "Expected 'in' in for-loop");
    const iterable = parseExpression();
    expect("COLON", "Expected ':' after for-loop header");
    expect("NEWLINE", "Expected newline after for-loop header");
    const body = parseIndentedBlock();
    let elseBlock = null;
    if (peek().type === "KEYWORD" && peek().value === "else") {
      advance();
      expect("COLON", "Expected ':' after else");
      expect("NEWLINE", "Expected newline after else");
      elseBlock = parseIndentedBlock();
    }
    return { type: "ForStatement", iterVars, iterable, body, elseBlock };
  }

  function parseTryStatement() {
    expectKeyword("try", "Expected 'try'");
    expect("COLON", "Expected ':' after 'try'");
    expect("NEWLINE", "Expected newline after 'try:'");
    const tryBlock = parseIndentedBlock();

    const handlers = [];
    while (peek().type === "KEYWORD" && peek().value === "except") {
      advance();
      let excType = null;
      let excName = null;
      if (!check("COLON")) {
        excType = parseExpression();
        if (matchKeyword("as")) excName = expect("IDENT", "Expected identifier after 'as'").value;
      }
      expect("COLON", "Expected ':' after except");
      expect("NEWLINE", "Expected newline after except");
      const catchBlock = parseIndentedBlock();
      handlers.push({ excType, excName, body: catchBlock });
    }

    let finallyBlock = null;
    if (peek().type === "KEYWORD" && peek().value === "finally") {
      advance();
      expect("COLON", "Expected ':' after finally");
      expect("NEWLINE", "Expected newline after finally");
      finallyBlock = parseIndentedBlock();
    }

    if (handlers.length === 0 && finallyBlock === null) {
      throw new Error("SyntaxError: expected 'except' or 'finally' after try");
    }

    return { type: "TryStatement", tryBlock, handlers, finallyBlock };
  }

  function parseImportStatement() {
    expectKeyword("import", "Expected 'import'");
    const names = [expect("IDENT", "Expected module name").value];
    while (match("COMMA")) names.push(expect("IDENT", "Expected module name").value);
    return { type: "ImportStatement", names };
  }

  function parseFromImportStatement() {
    expectKeyword("from", "Expected 'from'");
    const module = expect("IDENT", "Expected module name").value;
    expectKeyword("import", "Expected 'import'");
    const names = [];
    if (match("STAR")) {
      names.push("*");
    } else {
      names.push(expect("IDENT", "Expected name").value);
      while (match("COMMA")) names.push(expect("IDENT", "Expected name").value);
    }
    return { type: "FromImportStatement", module, names };
  }

  function parseIndentedBlock() {
    expect("INDENT", "Expected an indented block");
    const body = [];
    skipNewlines();
    while (!check("DEDENT") && !check("EOF")) {
      body.push(parseStatement());
      skipNewlines();
    }
    expect("DEDENT", "Expected end of block (dedent)");
    return { type: "BlockStatement", body };
  }

  function parseExpressionStatement() {
    const expr = parseExpression();
    return { type: "ExpressionStatement", expression: expr };
  }

  // ================ EXPRESSION PARSER ================

  function parseExpression() {
    // Check for lambda
    if (peek().type === "KEYWORD" && peek().value === "lambda") {
      return parseLambda();
    }
    // Check for conditional expression: expr if cond else expr
    let expr = parseTernary();
    return expr;
  }

  function parseLambda() {
    expectKeyword("lambda", "Expected 'lambda'");
    const params = [];
    if (!check("COLON")) {
      params.push(expect("IDENT", "Expected param").value);
      while (match("COMMA") && !check("COLON")) {
        params.push(expect("IDENT", "Expected param").value);
      }
    }
    expect("COLON", "Expected ':' after lambda params");
    const body = parseTernary();
    return { type: "LambdaExpression", params, body };
  }

  function parseTernary() {
    let expr = parseOr();
    if (peek().type === "KEYWORD" && peek().value === "if") {
      advance(); // consume 'if'
      const condition = parseOr();
      expectKeyword("else", "Expected 'else' in ternary");
      const alternate = parseTernary();
      expr = { type: "TernaryExpression", condition, consequent: expr, alternate };
    }
    return expr;
  }

  function parseOr() {
    let expr = parseAnd();
    while (peek().type === "KEYWORD" && peek().value === "or") {
      advance();
      const right = parseAnd();
      expr = { type: "BinaryExpression", operator: "or", left: expr, right };
    }
    return expr;
  }

  function parseAnd() {
    let expr = parseNot();
    while (peek().type === "KEYWORD" && peek().value === "and") {
      advance();
      const right = parseNot();
      expr = { type: "BinaryExpression", operator: "and", left: expr, right };
    }
    return expr;
  }

  function parseNot() {
    if (peek().type === "KEYWORD" && peek().value === "not") {
      advance();
      const arg = parseNot();
      return { type: "UnaryExpression", operator: "not", argument: arg };
    }
    return parseComparison();
  }

  function parseComparison() {
    let expr = parseBitOr();

    // Chained comparison: a < b < c becomes a < b and b < c
    const cmpOps = ["EQEQ", "NOTEQ", "LT", "GT", "LTE", "GTE"];
    const isOp = (t) => cmpOps.includes(t.type) ||
      (t.type === "KEYWORD" && (t.value === "in" || t.value === "is" || t.value === "not"));

    if (isOp(peek())) {
      const comparisons = [expr];
      const operators = [];
      while (true) {
        const t = peek();
        let op = null;
        if (cmpOps.includes(t.type)) {
          op = advance().value || t.type;
          if (t.type === "LT") op = "<";
          if (t.type === "GT") op = ">";
        } else if (t.type === "KEYWORD" && t.value === "is") {
          advance();
          if (peek().type === "KEYWORD" && peek().value === "not") {
            advance();
            op = "is not";
          } else {
            op = "is";
          }
        } else if (t.type === "KEYWORD" && t.value === "not") {
          const saved = current;
          advance();
          if (peek().type === "KEYWORD" && peek().value === "in") {
            advance();
            op = "not in";
          } else {
            current = saved;
            break;
          }
        } else if (t.type === "KEYWORD" && t.value === "in") {
          advance();
          op = "in";
        } else {
          break;
        }
        operators.push(op);
        comparisons.push(parseBitOr());
      }
      if (comparisons.length === 2) {
        return { type: "BinaryExpression", operator: operators[0], left: comparisons[0], right: comparisons[1] };
      }
      // chained: build (a op b) and (b op c) etc
      const parts = [];
      for (let i = 0; i < operators.length; i++) {
        parts.push({ type: "BinaryExpression", operator: operators[i], left: comparisons[i], right: comparisons[i+1] });
      }
      let result = parts[0];
      for (let i = 1; i < parts.length; i++) {
        result = { type: "BinaryExpression", operator: "and", left: result, right: parts[i] };
      }
      return result;
    }
    return expr;
  }

  function parseBitOr() {
    let expr = parseBitAnd();
    while (check("PIPE")) {
      advance();
      const right = parseBitAnd();
      expr = { type: "BinaryExpression", operator: "|", left: expr, right };
    }
    return expr;
  }

  function parseBitAnd() {
    let expr = parseAdditive();
    while (check("AMPERSAND")) {
      advance();
      const right = parseAdditive();
      expr = { type: "BinaryExpression", operator: "&", left: expr, right };
    }
    return expr;
  }

  function parseAdditive() {
    let expr = parseMultiplicative();
    while (check("PLUS") || check("MINUS")) {
      const op = check("PLUS") ? "+" : "-";
      advance();
      const right = parseMultiplicative();
      expr = { type: "BinaryExpression", operator: op, left: expr, right };
    }
    return expr;
  }

  function parseMultiplicative() {
    let expr = parsePower();
    while (check("STAR") || check("SLASH") || check("PERCENT") || check("DOUBLESLASH")) {
      let op;
      if (check("STAR")) op = "*";
      else if (check("SLASH")) op = "/";
      else if (check("PERCENT")) op = "%";
      else op = "//";
      advance();
      const right = parsePower();
      expr = { type: "BinaryExpression", operator: op, left: expr, right };
    }
    return expr;
  }

  function parsePower() {
    let base = parseUnary();
    if (check("STARSTAR")) {
      advance();
      const exp = parsePower(); // right-associative
      return { type: "BinaryExpression", operator: "**", left: base, right: exp };
    }
    return base;
  }

  function parseUnary() {
    if (check("MINUS")) {
      advance();
      return { type: "UnaryExpression", operator: "-", argument: parseUnary() };
    }
    if (check("PLUS")) {
      advance();
      return { type: "UnaryExpression", operator: "+", argument: parseUnary() };
    }
    if (check("TILDE")) {
      advance();
      return { type: "UnaryExpression", operator: "~", argument: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let expr = parsePrimary();

    while (true) {
      if (check("LBRACKET")) {
        advance();
        if (check("RBRACKET")) throw new Error("SyntaxError: empty index '[]'");

        let start = null, end = null, step = null;
        let isSlice = false;

        if (!check("COLON")) start = parseExpression();

        if (match("COLON")) {
          isSlice = true;
          if (!check("COLON") && !check("RBRACKET")) end = parseExpression();
          if (match("COLON") && !check("RBRACKET")) step = parseExpression();
        }

        expect("RBRACKET", "Expected ']'");

        if (isSlice) {
          expr = { type: "SliceExpression", array: expr, start, end, step };
        } else {
          expr = { type: "IndexExpression", array: expr, index: start };
        }
      } else if (check("DOT")) {
        advance();
        const prop = expect("IDENT", "Expected property name after '.'");
        expr = { type: "PropertyAccess", object: expr, property: prop.value };
      } else if (check("LPAREN")) {
        advance();
        const args = [];
        const kwargs = {};
        if (!check("RPAREN")) {
          do {
            // keyword argument: name=value
            if (check("IDENT") && peek(1).type === "EQUAL") {
              const kw = advance().value;
              advance(); // =
              kwargs[kw] = parseExpression();
            } else if (check("STAR")) {
              advance(); // *
              const splat = parseExpression();
              args.push({ type: "Splat", value: splat });
            } else if (check("STARSTAR")) {
              advance(); // **
              const splat = parseExpression();
              args.push({ type: "DoubleSplat", value: splat });
            } else {
              args.push(parseExpression());
            }
          } while (match("COMMA") && !check("RPAREN"));
        }
        expect("RPAREN", "Expected ')'");
        expr = { type: "CallExpression", callee: expr, arguments: args, kwargs };
      } else if (check("WALRUS")) {
        // walrus inside expression: name := value — only valid if expr is Identifier
        if (expr.type !== "Identifier") throw new Error("SyntaxError: walrus target must be identifier");
        advance();
        const value = parseExpression();
        expr = { type: "WalrusExpression", name: expr.name, value };
      } else {
        break;
      }
    }

    return expr;
  }

  function parsePrimary() {
    // Number
    if (check("NUMBER")) return { type: "NumericLiteral", value: advance().value };

    // Boolean
    if (check("BOOLEAN")) return { type: "BooleanLiteral", value: advance().value };

    // None
    if (check("NONE")) { advance(); return { type: "NullLiteral" }; }

    // String
    if (check("STRING")) return { type: "StringLiteral", value: advance().value };

    // f-string
    if (check("FSTRING")) {
      const raw = advance().value;
      return { type: "FStringLiteral", raw };
    }

    // List literal
    if (check("LBRACKET")) {
      advance();
      const elements = [];
      skipNewlines();
      if (!check("RBRACKET")) {
        do {
          skipNewlines();
          if (check("RBRACKET")) break;
          // check for comprehension: expr for var in iterable
          const elemExpr = parseExpression();
          skipNewlines();
          if (peek().type === "KEYWORD" && peek().value === "for") {
            // list comprehension
            advance(); // consume 'for'
            const iterVars = [expect("IDENT", "Expected identifier").value];
            while (match("COMMA") && check("IDENT")) iterVars.push(advance().value);
            expectKeyword("in", "Expected 'in' in comprehension");
            const iterExpr = parseExpression();
            let filterExpr = null;
            if (peek().type === "KEYWORD" && peek().value === "if") {
              advance();
              filterExpr = parseExpression();
            }
            skipNewlines();
            expect("RBRACKET", "Expected ']' after list comprehension");
            return { type: "ListComprehension", expression: elemExpr, iterVars, iterable: iterExpr, filter: filterExpr };
          }
          elements.push(elemExpr);
        } while (match("COMMA") && !check("RBRACKET"));
      }
      skipNewlines();
      expect("RBRACKET", "Expected ']' after list literal");
      return { type: "ArrayLiteral", elements };
    }

    // Dict or Set literal
    if (check("LBRACE")) {
      advance();
      skipNewlines();
      if (check("RBRACE")) { advance(); return { type: "DictLiteral", entries: [] }; }

      // Peek: if key is followed by colon -> dict, else set
      const saved = current;
      let isDict = false;
      try {
        const testExpr = parseExpression();
        if (check("COLON")) isDict = true;
        current = saved;
      } catch(e) { current = saved; }

      if (isDict) {
        const entries = [];
        do {
          skipNewlines();
          if (check("RBRACE")) break;
          let keyNode;
          if (check("STARSTAR")) {
            advance();
            keyNode = { type: "DoubleSplat", value: parseExpression() };
            entries.push({ key: null, value: null, splat: keyNode });
            continue;
          }
          keyNode = parseExpression();
          expect("COLON", "Expected ':' in dict");
          const valNode = parseExpression();
          entries.push({ key: keyNode, value: valNode });
        } while (match("COMMA") && !check("RBRACE"));
        skipNewlines();
        expect("RBRACE", "Expected '}'");
        return { type: "DictLiteral", entries };
      } else {
        // set literal
        const elements = [];
        do {
          skipNewlines();
          if (check("RBRACE")) break;
          elements.push(parseExpression());
        } while (match("COMMA") && !check("RBRACE"));
        skipNewlines();
        expect("RBRACE", "Expected '}'");
        return { type: "SetLiteral", elements };
      }
    }

    // Tuple literal with parens: (a, b) or (a,)
    if (check("LPAREN")) {
      advance();
      skipNewlines();
      if (check("RPAREN")) { advance(); return { type: "TupleLiteral", elements: [] }; }
      const first = parseExpression();
      skipNewlines();
      if (check("COMMA")) {
        advance();
        const elements = [first];
        while (!check("RPAREN") && !check("EOF")) {
          skipNewlines();
          if (check("RPAREN")) break;
          elements.push(parseExpression());
          skipNewlines();
          if (!match("COMMA")) break;
        }
        skipNewlines();
        expect("RPAREN", "Expected ')'");
        return { type: "TupleLiteral", elements };
      }
      skipNewlines();
      expect("RPAREN", "Expected ')'");
      return first;
    }

    // Identifier
    if (check("IDENT")) {
      return { type: "Identifier", name: advance().value };
    }

    // Lambda starting in primary position
    if (peek().type === "KEYWORD" && peek().value === "lambda") {
      return parseLambda();
    }

    throw new Error("SyntaxError: unexpected token '" + peek().type + "' '" + (peek().value||"") + "'");
  }

  return { parseProgram };
}

// =========================== INTERPRETER ===========================

class EduPyReturn { constructor(v) { this.value = v; } }
class EduPyBreak {}
class EduPyContinue {}
class EduPyError { constructor(msg, type="Error") { this.message = msg; this.type = type; } }

function pyRepr(v, seen = new Set()) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    // format like Python: remove trailing zeros but keep decimal
    let s = v.toPrecision(15).replace(/0+$/, "").replace(/\.$/, ".0");
    if (!s.includes('.') && !s.includes('e')) s += ".0";
    return s;
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (seen.has(v)) return "[...]";
    seen.add(v);
    if (v.__isTuple) return "(" + v.map(x => pyRepr(x, seen)).join(", ") + (v.length===1?",":"") + ")";
    if (v.__isSet) return v.length === 0 ? "set()" : "{" + v.map(x => pyRepr(x, seen)).join(", ") + "}";
    return "[" + v.map(x => pyRepr(x, seen)).join(", ") + "]";
  }
  if (typeof v === "function") return "<function>";
  if (v && v.__type === "UserFunction") return "<function " + (v.name || "?") + ">";
  if (v && v.__type === "UserClass") return "<class '" + v.name + "'>";
  if (v && v.__type === "UserInstance") {
    // Check for __repr__ or __str__
    if (v.__class && v.__class.__methods && v.__class.__methods.__repr__) {
      try { return pyStr(callMethod(v, "__repr__", [])); } catch(e) {}
    }
    return "<" + (v.__className || "object") + " object>";
  }
  if (v && typeof v === "object") {
    if (seen.has(v)) return "{...}";
    seen.add(v);
    const entries = Object.entries(v).filter(([k]) => !k.startsWith("__"));
    return "{" + entries.map(([k,val]) => JSON.stringify(k) + ": " + pyRepr(val, seen)).join(", ") + "}";
  }
  return String(v);
}

function pyStr(v) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    let s = v.toPrecision(15).replace(/0+$/, "").replace(/\.$/, ".0");
    return s;
  }
  if (Array.isArray(v)) {
    if (v.__isTuple) return "(" + v.map(x => pyRepr(x)).join(", ") + (v.length===1?",":"") + ")";
    if (v.__isSet) return v.length === 0 ? "set()" : "{" + v.map(x => pyRepr(x)).join(", ") + "}";
    return "[" + v.map(x => pyRepr(x)).join(", ") + "]";
  }
  if (v && v.__type === "UserInstance") {
    if (v.__class && v.__class.__methods && v.__class.__methods.__str__) {
      try { return String(callMethod(v, "__str__", [])); } catch(e) {}
    }
    return "<" + (v.__className || "object") + " object>";
  }
  if (v && typeof v === "object" && !Array.isArray(v)) return pyRepr(v);
  return String(v);
}

function truthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") {
    // check __bool__ or __len__
    if (v.__type === "UserInstance") {
      if (v.__class && v.__class.__methods && v.__class.__methods.__bool__) {
        try { return truthy(callMethod(v, "__bool__", [])); } catch(e) {}
      }
      if (v.__class && v.__class.__methods && v.__class.__methods.__len__) {
        try { return callMethod(v, "__len__", []) !== 0; } catch(e) {}
      }
    }
    const keys = Object.keys(v).filter(k => !k.startsWith("__"));
    return keys.length > 0;
  }
  return Boolean(v);
}

// Placeholder for callMethod (defined inside createInterpreter)
let callMethod = () => { throw new Error("callMethod not ready"); };

function createInterpreter(outputFn) {
  // ===== BUILT-IN MODULES =====
  const mathModule = {
    pi: Math.PI, e: Math.E, tau: 2 * Math.PI, inf: Infinity, nan: NaN,
    sqrt: (x) => Math.sqrt(x),
    pow: (a, b) => Math.pow(a, b),
    sin: (x) => Math.sin(x),
    cos: (x) => Math.cos(x),
    tan: (x) => Math.tan(x),
    asin: (x) => Math.asin(x),
    acos: (x) => Math.acos(x),
    atan: (x) => Math.atan(x),
    atan2: (y, x) => Math.atan2(y, x),
    sinh: (x) => Math.sinh(x),
    cosh: (x) => Math.cosh(x),
    tanh: (x) => Math.tanh(x),
    log: (x, base) => base !== undefined ? Math.log(x) / Math.log(base) : Math.log(x),
    log2: (x) => Math.log2(x),
    log10: (x) => Math.log10(x),
    exp: (x) => Math.exp(x),
    abs: (x) => Math.abs(x),
    floor: (x) => Math.floor(x),
    ceil: (x) => Math.ceil(x),
    round: (x, n) => n !== undefined ? Math.round(x * 10**n) / 10**n : Math.round(x),
    trunc: (x) => Math.trunc(x),
    max: (...a) => Math.max(...a.flat()),
    min: (...a) => Math.min(...a.flat()),
    gcd: (a, b) => { a = Math.abs(a|0); b = Math.abs(b|0); while(b){const t=b;b=a%b;a=t;} return a; },
    factorial: (n) => { n=n|0; if(n<0) throw new Error("ValueError: factorial() not defined for negative values"); let r=1; for(let i=2;i<=n;i++) r*=i; return r; },
    isnan: (x) => isNaN(x),
    isinf: (x) => !isFinite(x),
    isfinite: (x) => isFinite(x),
    degrees: (x) => x * (180 / Math.PI),
    radians: (x) => x * (Math.PI / 180),
    hypot: (...args) => Math.hypot(...args.flat()),
    comb: (n, k) => {
      n=n|0; k=k|0;
      if(k<0||k>n) return 0;
      if(k===0||k===n) return 1;
      let r=1; for(let i=0;i<k;i++){r=r*(n-i)/(i+1);} return Math.round(r);
    },
    perm: (n, k) => {
      n=n|0; k=k|0;
      if(k<0||k>n) return 0;
      let r=1; for(let i=0;i<k;i++) r*=(n-i); return r;
    },
    fmod: (x, y) => x % y,
    modf: (x) => { const i=Math.trunc(x); return mkTuple([x-i, i]); },
    frexp: (x) => { if(x===0) return mkTuple([0,0]); const e=Math.floor(Math.log2(Math.abs(x)))+1; return mkTuple([x/Math.pow(2,e),e]); },
    copysign: (x, y) => Math.sign(y)*Math.abs(x),
  };

  const randomModule = {
    _seed: Date.now(),
    _rng: null,
    _getRng() {
      if (!this._rng) {
        let s = (this._seed | 0) >>> 0;
        this._rng = () => { s=(s*1664525+1013904223)>>>0; return s/4294967296; };
      }
      return this._rng;
    },
    seed(s) { this._seed = typeof s==="number"?s:0; this._rng=null; },
    random() { return this._getRng()(); },
    randint(a, b) { a=Math.floor(a); b=Math.floor(b); return Math.floor(this._getRng()()*( b-a+1))+a; },
    uniform(a, b) { return a + this._getRng()()*(b-a); },
    choice(arr) {
      if (!Array.isArray(arr)||arr.length===0) throw new Error("IndexError: cannot choose from empty sequence");
      return arr[Math.floor(this._getRng()()*arr.length)];
    },
    choices(population, k=1) {
      const r=this._getRng();
      return Array.from({length:k},()=>population[Math.floor(r()*population.length)]);
    },
    sample(population, k) {
      if (k>population.length) throw new Error("ValueError: sample larger than population");
      const pool=[...population]; const res=[];
      const r=this._getRng();
      for(let i=0;i<k;i++){const j=Math.floor(r()*(pool.length-i)); res.push(pool[j]); pool[j]=pool[pool.length-1-i];}
      return res;
    },
    shuffle(arr) {
      const r=this._getRng();
      for(let i=arr.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
      return null;
    },
    gauss(mu=0, sigma=1) {
      const r=this._getRng();
      const u=1-r(), v=r();
      return mu+sigma*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
    },
    normalvariate(mu=0, sigma=1) { return this.gauss(mu, sigma); },
    randrange(start, stop, step=1) {
      if(stop===undefined){stop=start;start=0;}
      const n=Math.ceil((stop-start)/step);
      return start+step*Math.floor(this._getRng()()*n);
    },
  };

  const datetimeModule = {
    now() {
      const d=new Date();
      const obj={year:d.getFullYear(),month:d.getMonth()+1,day:d.getDate(),
        hour:d.getHours(),minute:d.getMinutes(),second:d.getSeconds(),
        microsecond:0, isoformat:()=>d.toISOString(), __type:"datetime_obj"};
      return obj;
    },
    today() { const d=new Date(); return {year:d.getFullYear(),month:d.getMonth()+1,day:d.getDate()}; },
    strftime(fmt, dt) {
      const d=dt instanceof Date?dt:new Date();
      return fmt.replace(/%Y/g,d.getFullYear()).replace(/%m/g,String(d.getMonth()+1).padStart(2,'0'))
        .replace(/%d/g,String(d.getDate()).padStart(2,'0'))
        .replace(/%H/g,String(d.getHours()).padStart(2,'0'))
        .replace(/%M/g,String(d.getMinutes()).padStart(2,'0'))
        .replace(/%S/g,String(d.getSeconds()).padStart(2,'0'));
    },
  };

  const osModule = {
    path: {
      join: (...parts) => parts.join('/'),
      exists: (_) => false,
      basename: (p) => p.split('/').pop(),
      dirname: (p) => p.split('/').slice(0,-1).join('/') || '.',
      splitext: (p) => { const i=p.lastIndexOf('.'); return i<0?[p,'']:[p.slice(0,i),p.slice(i)]; },
    },
    getcwd: () => "/edupy",
    listdir: (_) => [],
    getenv: (key, def=null) => def,
  };

  const sysModule = {
    argv: ["edupy"],
    version: "3.11 (EduPy)",
    platform: "browser",
    exit: (code=0) => { throw new EduPyError("SystemExit: " + code, "SystemExit"); },
    stdout: { write: (s) => { outputFn(s); return null; } },
    stderr: { write: (s) => { outputFn("ERR: "+s); return null; } },
    maxsize: 2**53,
  };

  const jsonModule = {
    dumps: (obj, ...args) => JSON.stringify(obj),
    loads: (s) => JSON.parse(s),
  };

  const collectionsModule = {
    Counter: (iterable) => {
      const c={};
      if (Array.isArray(iterable)) for(const v of iterable) c[String(v)]=(c[String(v)]||0)+1;
      else if(typeof iterable==="string") for(const ch of iterable) c[ch]=(c[ch]||0)+1;
      c.__isCounter=true;
      c.most_common = (n) => {
        let pairs=Object.entries(c).filter(([k])=>!k.startsWith('__')).map(([k,v])=>{const t=mkTuple([k,v]);return t;});
        pairs.sort((a,b)=>b[1]-a[1]);
        return n!==undefined?pairs.slice(0,n):pairs;
      };
      return c;
    },
    defaultdict: (factory) => {
      const d={}; d.__factory=factory; d.__isDefaultDict=true;
      return new Proxy(d,{get(t,k){
        if(k in t) return t[k];
        const v=factory();t[k]=v;return v;
      }});
    },
    OrderedDict: () => ({}),
    deque: (iterable=[]) => {
      const d=[...iterable];
      d.appendleft=(v)=>d.unshift(v);
      d.popleft=()=>d.shift();
      d.rotate=(n=1)=>{if(d.length===0)return;n=((n%d.length)+d.length)%d.length;d.unshift(...d.splice(d.length-n,n));};
      return d;
    },
    namedtuple: (name, fields) => {
      if (typeof fields==="string") fields=fields.split(/[\s,]+/);
      return (...args) => {
        const obj={__type:"namedtuple",__name:name};
        fields.forEach((f,i)=>obj[f]=args[i]);
        return obj;
      };
    },
  };

  // ===== GLOBAL SCOPE =====
  const globalScope = {
    // Built-in functions
    print: (...args) => {
      // Handle sep and end kwargs
      let sep = " ", end = "\n";
      const filtered = [];
      for (const a of args) {
        if (a && a.__kwarg_sep !== undefined) sep = a.__kwarg_sep;
        else if (a && a.__kwarg_end !== undefined) end = a.__kwarg_end;
        else filtered.push(a);
      }
      outputFn(filtered.map(pyStr).join(sep));
      return null;
    },
    input: (prompt = "") => {
      const r = window.prompt(pyStr(prompt));
      return r !== null ? r : "";
    },
    len: (v) => {
      if (typeof v === "string" || Array.isArray(v)) return v.length;
      if (v && typeof v === "object") {
        if (v.__type === "UserInstance") {
          if (v.__class && v.__class.__methods && v.__class.__methods.__len__)
            return callMethod(v, "__len__", []);
        }
        return Object.keys(v).filter(k=>!k.startsWith("__")).length;
      }
      throw new Error("TypeError: object of type '" + typeof v + "' has no len()");
    },
    range: (...args) => {
      let start=0, stop, step=1;
      if (args.length===1) { stop=args[0]|0; }
      else if (args.length===2) { start=args[0]|0; stop=args[1]|0; }
      else if (args.length===3) { start=args[0]|0; stop=args[1]|0; step=args[2]|0; }
      else throw new Error("TypeError: range expected at most 3 arguments");
      if (step===0) throw new Error("ValueError: range() arg 3 must not be zero");
      const r=[];
      if (step>0) for(let i=start;i<stop;i+=step) r.push(i);
      else for(let i=start;i>stop;i+=step) r.push(i);
      return r;
    },
    int: (x, base) => {
      if (x === null || x === undefined) return 0;
      if (typeof x === "boolean") return x ? 1 : 0;
      if (typeof x === "number") return Math.trunc(x);
      if (typeof x === "string") {
        const n = base !== undefined ? parseInt(x.trim(), base) : parseInt(x.trim(), 10);
        if (isNaN(n)) throw new Error("ValueError: invalid literal for int(): '" + x + "'");
        return n;
      }
      throw new Error("TypeError: int() argument must be a string or a number");
    },
    float: (x) => {
      if (x === null) return 0.0;
      if (typeof x === "boolean") return x ? 1.0 : 0.0;
      const n = parseFloat(x);
      if (isNaN(n) && x !== "nan") throw new Error("ValueError: could not convert to float: '" + x + "'");
      return n;
    },
    str: (x) => pyStr(x),
    repr: (x) => pyRepr(x),
    bool: (x) => truthy(x),
    list: (x) => {
      if (x === null || x === undefined) return [];
      if (Array.isArray(x)) return [...x];
      if (typeof x === "string") return x.split("");
      if (x && typeof x === "object") {
        if (typeof x[Symbol.iterator] === "function") return [...x];
        return Object.keys(x).filter(k=>!k.startsWith("__"));
      }
      throw new Error("TypeError: '" + typeof x + "' object is not iterable");
    },
    tuple: (x) => {
      const arr = Array.isArray(x) ? [...x] : (typeof x==="string" ? x.split("") : []);
      return mkTuple(arr);
    },
    set: (x) => {
      const arr = x ? (Array.isArray(x) ? [...x] : (typeof x==="string" ? x.split("") : [])) : [];
      const unique = [...new Set(arr.map(v => JSON.stringify(v)))].map(v => JSON.parse(v));
      return mkSet(unique);
    },
    dict: (x) => {
      if (!x) return {};
      if (Array.isArray(x)) {
        const obj={};
        for(const pair of x) {
          if(Array.isArray(pair)&&pair.length>=2) obj[String(pair[0])]=pair[1];
        }
        return obj;
      }
      if (typeof x==="object") return {...x};
      return {};
    },
    frozenset: (x) => {
      const arr = x ? (Array.isArray(x) ? [...x] : []) : [];
      return mkSet([...new Set(arr.map(v=>JSON.stringify(v)))].map(v=>JSON.parse(v)));
    },
    type: (x) => {
      if (x === null || x === undefined) return "<class 'NoneType'>";
      if (typeof x === "boolean") return "<class 'bool'>";
      if (typeof x === "number") return Number.isInteger(x) ? "<class 'int'>" : "<class 'float'>";
      if (typeof x === "string") return "<class 'str'>";
      if (Array.isArray(x)) {
        if (x.__isTuple) return "<class 'tuple'>";
        if (x.__isSet) return "<class 'set'>";
        return "<class 'list'>";
      }
      if (x && x.__type === "UserInstance") return "<class '" + x.__className + "'>";
      if (x && x.__type === "UserClass") return "<class 'type'>";
      if (typeof x === "function" || (x && x.__type === "UserFunction")) return "<class 'function'>";
      return "<class 'dict'>";
    },
    isinstance: (obj, cls) => {
      if (cls === null) return false;
      const t = typeof obj;
      if (cls === "<class 'int'>" || cls === "int") return typeof obj==="number" && Number.isInteger(obj);
      if (cls === "<class 'float'>" || cls === "float") return typeof obj==="number";
      if (cls === "<class 'str'>" || cls === "str") return typeof obj==="string";
      if (cls === "<class 'list'>" || cls === "list") return Array.isArray(obj) && !obj.__isTuple;
      if (cls === "<class 'dict'>" || cls === "dict") return typeof obj==="object" && obj!==null && !Array.isArray(obj);
      if (cls === "<class 'bool'>" || cls === "bool") return typeof obj==="boolean";
      if (obj && obj.__type==="UserInstance" && cls && cls.__type==="UserClass") return obj.__className===cls.name;
      return false;
    },
    issubclass: (cls, base) => cls === base,
    callable: (x) => typeof x==="function" || (x && (x.__type==="UserFunction" || x.__type==="UserClass")),
    hasattr: (obj, name) => {
      try { return getAttr(obj, name) !== undefined; } catch(e) { return false; }
    },
    getattr: (obj, name, def) => {
      try { return getAttr(obj, name); } catch(e) { if(def!==undefined) return def; throw e; }
    },
    setattr: (obj, name, value) => {
      if (obj && typeof obj==="object") { obj[name]=value; return null; }
      throw new Error("TypeError: setattr requires an object");
    },
    delattr: (obj, name) => { if(obj&&typeof obj==="object") delete obj[name]; return null; },
    // Iteration helpers
    enumerate: (iterable, start=0) => {
      const arr = asArray(iterable);
      return arr.map((v,i) => mkTuple([i+start, v]));
    },
    zip: (...iterables) => {
      const arrs = iterables.map(asArray);
      const minLen = Math.min(...arrs.map(a=>a.length));
      return Array.from({length:minLen}, (_,i) => mkTuple(arrs.map(a=>a[i])));
    },
    map: (fn, ...iterables) => {
      if (iterables.length===1) return iterables[0].map(v => callFn(fn,[v]));
      const arrs = iterables.map(asArray);
      const minLen = Math.min(...arrs.map(a=>a.length));
      return Array.from({length:minLen},(_,i)=>callFn(fn,arrs.map(a=>a[i])));
    },
    filter: (fn, iterable) => {
      const arr = asArray(iterable);
      if (fn === null || fn === undefined) return arr.filter(v=>truthy(v));
      return arr.filter(v=>truthy(callFn(fn,[v])));
    },
    reduce: (fn, iterable, init) => {
      const arr = asArray(iterable);
      if (arr.length===0 && init===undefined) throw new Error("TypeError: reduce() of empty sequence with no initial value");
      let acc = init !== undefined ? init : arr[0];
      const start = init !== undefined ? 0 : 1;
      for(let i=start;i<arr.length;i++) acc=callFn(fn,[acc,arr[i]]);
      return acc;
    },
    sorted: (iterable, key=null, reverse=false) => {
      // Handle kwargs object
      if (key && key.__kwarg_key !== undefined) { key = key.__kwarg_key; }
      if (reverse && typeof reverse==="object" && reverse.__kwarg_reverse !== undefined) reverse = reverse.__kwarg_reverse;
      const arr = [...asArray(iterable)];
      arr.sort((a,b) => {
        const ka = key ? callFn(key,[a]) : a;
        const kb = key ? callFn(key,[b]) : b;
        let r;
        if (typeof ka==="string" && typeof kb==="string") r = ka.localeCompare(kb);
        else r = ka < kb ? -1 : ka > kb ? 1 : 0;
        return reverse ? -r : r;
      });
      return arr;
    },
    reversed: (iterable) => [...asArray(iterable)].reverse(),
    sum: (iterable, start=0) => asArray(iterable).reduce((a,b)=>a+b, start),
    max: (...args) => {
      let arr = args.length===1 ? asArray(args[0]) : args;
      if(arr.length===0) throw new Error("ValueError: max() arg is an empty sequence");
      return arr.reduce((a,b)=>a>b?a:b);
    },
    min: (...args) => {
      let arr = args.length===1 ? asArray(args[0]) : args;
      if(arr.length===0) throw new Error("ValueError: min() arg is an empty sequence");
      return arr.reduce((a,b)=>a<b?a:b);
    },
    abs: (x) => Math.abs(x),
    round: (x, n) => {
      if(n===undefined) return Math.round(x);
      const p=10**n;
      return Math.round(x*p)/p;
    },
    pow: (base, exp, mod) => {
      const r = Math.pow(base, exp);
      return mod !== undefined ? r % mod : r;
    },
    divmod: (a, b) => mkTuple([Math.floor(a/b), a%b]),
    all: (iterable) => asArray(iterable).every(v=>truthy(v)),
    any: (iterable) => asArray(iterable).some(v=>truthy(v)),
    chr: (n) => String.fromCharCode(n),
    ord: (s) => {
      if(typeof s!=="string"||s.length!==1) throw new Error("TypeError: ord() expected a character");
      return s.charCodeAt(0);
    },
    hex: (n) => "0x" + Math.abs(n|0).toString(16),
    oct: (n) => "0o" + Math.abs(n|0).toString(8),
    bin: (n) => "0b" + Math.abs(n|0).toString(2),
    format: (value, spec) => pyFormat(value, spec||""),
    id: (x) => Math.random()|0, // dummy id
    hash: (x) => {
      if(typeof x==="number") return x|0;
      if(typeof x==="string"){let h=0;for(const c of x)h=(h*31+c.charCodeAt(0))|0;return h;}
      return 0;
    },
    open: (filename, mode="r") => {
      mode=mode||"r";
      if(mode.includes("r")){
        return {
          read:()=>{ const r=window.prompt("Simulated file read (paste content):"); return r||""; },
          readlines:()=>{ const r=window.prompt("Paste file content:"); return (r||"").split("\n"); },
          readline:()=>{ const r=window.prompt("Enter one line:"); return (r||"")+"\n"; },
          close:()=>null,
          __enter__:function(){return this;},
          __exit__:()=>null,
        };
      }
      return {
        write:(text)=>{ outputFn("[File write: " + pyStr(text) + "]"); return null; },
        writelines:(lines)=>{ for(const l of lines) outputFn("[File write: "+pyStr(l)+"]"); return null; },
        close:()=>null,
        __enter__:function(){return this;},
        __exit__:()=>null,
      };
    },
    print_r: (...args) => { outputFn(args.map(pyRepr).join(" ")); return null; },
    // String formatting
    vars: (obj) => {
      if(obj===undefined) return {};
      if(typeof obj==="object") return {...obj};
      return {};
    },
    dir: (obj) => {
      if (obj===undefined||obj===null) return [];
      return Object.keys(obj).filter(k=>!k.startsWith("__"));
    },
    help: (obj) => { outputFn("Help is not available in EduPy."); return null; },
    exit: () => { throw new EduPyError("SystemExit", "SystemExit"); },
    quit: () => { throw new EduPyError("SystemExit", "SystemExit"); },
    // Modules
    math: mathModule,
    random: randomModule,
    datetime: datetimeModule,
    os: osModule,
    sys: sysModule,
    json: jsonModule,
    collections: collectionsModule,
    time: {
      time: () => Date.now()/1000,
      sleep: (s) => { outputFn("[sleep " + s + "s - skipped in EduPy]"); return null; },
      strftime: (fmt) => datetimeModule.strftime(fmt, new Date()),
    },
    re: {
      match: (pat, s) => { const m=new RegExp(pat).exec(s); return m?{group:()=>m[0]}:null; },
      search: (pat, s) => { const m=new RegExp(pat).exec(s); return m?{group:()=>m[0]}:null; },
      findall: (pat, s) => s.match(new RegExp(pat,'g'))||[],
      sub: (pat, repl, s) => s.replace(new RegExp(pat,'g'),repl),
      split: (pat, s) => s.split(new RegExp(pat)),
      compile: (pat, flags) => ({
        match: (s)=>{const m=new RegExp(pat).exec(s);return m?{group:()=>m[0]}:null;},
        search: (s)=>{const m=new RegExp(pat).exec(s);return m?{group:()=>m[0]}:null;},
        findall: (s)=>s.match(new RegExp(pat,'g'))||[],
        sub: (repl,s)=>s.replace(new RegExp(pat,'g'),repl),
      }),
    },
    itertools: {
      chain: (...iterables) => iterables.flat(),
      product: (...iterables) => {
        const arrs=iterables.map(asArray);
        const r=[[]];
        for(const a of arrs){const nr=[];for(const p of r)for(const v of a)nr.push([...p,v]);r.splice(0,r.length,...nr);}
        return r.map(p=>mkTuple(p));
      },
      permutations: (iterable, r) => {
        const arr=asArray(iterable);
        r=r===undefined?arr.length:r;
        const res=[];
        const perm=(cur,rest)=>{if(cur.length===r){res.push(mkTuple([...cur]));return;}for(let i=0;i<rest.length;i++){const next=[...rest];next.splice(i,1);perm([...cur,rest[i]],next);}};
        perm([],arr);
        return res;
      },
      combinations: (iterable, r) => {
        const arr=asArray(iterable);
        const res=[];
        const comb=(cur,start)=>{if(cur.length===r){res.push(mkTuple([...cur]));return;}for(let i=start;i<arr.length;i++)comb([...cur,arr[i]],i+1);};
        comb([],0);
        return res;
      },
      repeat: (x, times) => { const r=[]; for(let i=0;i<(times||0);i++) r.push(x); return r; },
      accumulate: (iterable) => { const arr=asArray(iterable); const r=[]; let s=0; for(const v of arr){s+=v;r.push(s);} return r; },
      islice: (iterable, start, stop, step=1) => { const arr=asArray(iterable); if(stop===undefined){stop=start;start=0;} return arr.slice(start,stop).filter((_,i)=>i%step===0); },
    },
    functools: {
      reduce: (fn, iterable, init) => globalScope.reduce(fn, iterable, init),
      partial: (fn, ...partialArgs) => (...args) => callFn(fn, [...partialArgs, ...args]),
      lru_cache: (fn) => fn, // no-op cache
    },
    // Constants
    None: null,
    True: true,
    False: false,
    NotImplemented: "NotImplemented",
    Ellipsis: "...",
    // Exceptions (as strings/constructors)
    Exception: (msg) => ({ message: pyStr(msg||""), __type: "Exception" }),
    ValueError: (msg) => ({ message: "ValueError: " + pyStr(msg||""), __type: "ValueError" }),
    TypeError: (msg) => ({ message: "TypeError: " + pyStr(msg||""), __type: "TypeError" }),
    IndexError: (msg) => ({ message: "IndexError: " + pyStr(msg||""), __type: "IndexError" }),
    KeyError: (msg) => ({ message: "KeyError: " + pyStr(msg||""), __type: "KeyError" }),
    AttributeError: (msg) => ({ message: "AttributeError: " + pyStr(msg||""), __type: "AttributeError" }),
    NameError: (msg) => ({ message: "NameError: " + pyStr(msg||""), __type: "NameError" }),
    RuntimeError: (msg) => ({ message: "RuntimeError: " + pyStr(msg||""), __type: "RuntimeError" }),
    StopIteration: (msg) => ({ message: "StopIteration", __type: "StopIteration" }),
    ZeroDivisionError: (msg) => ({ message: "ZeroDivisionError: " + pyStr(msg||"division by zero"), __type: "ZeroDivisionError" }),
    OverflowError: (msg) => ({ message: "OverflowError: " + pyStr(msg||""), __type: "OverflowError" }),
    FileNotFoundError: (msg) => ({ message: "FileNotFoundError: " + pyStr(msg||""), __type: "FileNotFoundError" }),
    NotImplementedError: (msg) => ({ message: "NotImplementedError: " + pyStr(msg||""), __type: "NotImplementedError" }),
    AssertionError: (msg) => ({ message: "AssertionError: " + pyStr(msg||""), __type: "AssertionError" }),
    RecursionError: (msg) => ({ message: "RecursionError: " + pyStr(msg||""), __type: "RecursionError" }),
  };

  // Add string-based imports for common modules
  const modules = {
    math: mathModule, random: randomModule, datetime: datetimeModule,
    os: osModule, sys: sysModule, json: jsonModule, collections: collectionsModule,
    re: globalScope.re, itertools: globalScope.itertools, functools: globalScope.functools,
    time: globalScope.time,
    string: {
      ascii_letters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      ascii_lowercase: "abcdefghijklmnopqrstuvwxyz",
      ascii_uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      digits: "0123456789",
      punctuation: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
      whitespace: " \t\n\r",
      printable: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ \t\n\r",
    },
    copy: { copy: (x) => Array.isArray(x)?[...x]:{...x}, deepcopy: (x) => JSON.parse(JSON.stringify(x)) },
    pprint: { pprint: (x) => { outputFn(pyRepr(x)); return null; } },
    abc: { ABC: {}, abstractmethod: (fn)=>fn },
    typing: new Proxy({},{get:(_,k)=>k}),
    dataclasses: { dataclass: (cls)=>cls, field: ()=>null },
    enum: { Enum: {} },
  };

  const envStack = [globalScope];
  const globalVars = new Set(); // for 'global' statement

  function currentScope() { return envStack[envStack.length - 1]; }

  function defineVariable(name, value) { currentScope()[name] = value; }

  function assignVariable(name, value) {
    // If declared global, set in globalScope
    if (globalVars.has(name)) { envStack[0][name] = value; return value; }
    for (let i = envStack.length - 1; i >= 0; i--) {
      if (Object.prototype.hasOwnProperty.call(envStack[i], name)) {
        envStack[i][name] = value;
        return value;
      }
    }
    currentScope()[name] = value;
    return value;
  }

  function lookupVariable(name) {
    for (let i = envStack.length - 1; i >= 0; i--) {
      if (Object.prototype.hasOwnProperty.call(envStack[i], name)) return envStack[i][name];
    }
    throw new Error("NameError: name '" + name + "' is not defined");
  }

  // Helper: make a tuple (array tagged as tuple)
  function mkTuple(arr) {
    const t = [...arr];
    Object.defineProperty(t, "__isTuple", { value: true, enumerable: false });
    return t;
  }

  function mkSet(arr) {
    const s = [...arr];
    Object.defineProperty(s, "__isSet", { value: true, enumerable: false });
    // Set methods
    s.add = (v) => { if(!s.some(x=>JSON.stringify(x)===JSON.stringify(v))) s.push(v); return null; };
    s.remove = (v) => { const i=s.findIndex(x=>JSON.stringify(x)===JSON.stringify(v)); if(i<0)throw new Error("KeyError"); s.splice(i,1); return null; };
    s.discard = (v) => { const i=s.findIndex(x=>JSON.stringify(x)===JSON.stringify(v)); if(i>=0)s.splice(i,1); return null; };
    s.pop = () => { if(s.length===0)throw new Error("KeyError: pop from an empty set"); return s.pop(); };
    s.union = (other) => mkSet([...new Set([...s,...asArray(other)].map(v=>JSON.stringify(v)))].map(v=>JSON.parse(v)));
    s.intersection = (other) => { const o=new Set(asArray(other).map(v=>JSON.stringify(v))); return mkSet(s.filter(v=>o.has(JSON.stringify(v)))); };
    s.difference = (other) => { const o=new Set(asArray(other).map(v=>JSON.stringify(v))); return mkSet(s.filter(v=>!o.has(JSON.stringify(v)))); };
    s.issubset = (other) => { const o=new Set(asArray(other).map(v=>JSON.stringify(v))); return s.every(v=>o.has(JSON.stringify(v))); };
    s.issuperset = (other) => { const me=new Set(s.map(v=>JSON.stringify(v))); return asArray(other).every(v=>me.has(JSON.stringify(v))); };
    s.copy = () => mkSet([...s]);
    s.clear = () => { s.splice(0,s.length); return null; };
    return s;
  }

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") return v.split("");
    if (v && typeof v === "object") {
      if (typeof v[Symbol.iterator] === "function") return [...v];
      return Object.keys(v).filter(k=>!k.startsWith("__"));
    }
    return [];
  }

  function callFn(fn, args, kwargs={}) {
    if (fn === null || fn === undefined) throw new Error("TypeError: 'NoneType' object is not callable");
    if (typeof fn === "function") {
      // Handle kwargs for builtins
      if (Object.keys(kwargs).length > 0) {
        const kwObjs = Object.entries(kwargs).map(([k,v])=>({["__kwarg_"+k]:v}));
        return fn(...args, ...kwObjs);
      }
      return fn(...args);
    }
    if (fn.__type === "UserFunction") return callUserFn(fn, args, kwargs);
    if (fn.__type === "UserClass") return instantiateClass(fn, args, kwargs);
    throw new Error("TypeError: object is not callable: " + pyRepr(fn));
  }

  function callUserFn(fn, args, kwargs={}) {
    const newScope = Object.create(null);
    // Assign positional params
    for (let i = 0; i < fn.params.length; i++) {
      newScope[fn.params[i]] = args[i] !== undefined ? args[i] : (fn.defaults[fn.params[i]] !== undefined ? evaluate(fn.defaults[fn.params[i]]) : null);
    }
    // *args
    if (fn.hasVarargs) newScope[fn.varargsName] = args.slice(fn.params.length);
    // **kwargs
    if (fn.hasKwargs) newScope[fn.kwargsName] = {...kwargs};
    // keyword args
    for (const [k,v] of Object.entries(kwargs)) {
      if (fn.params.includes(k)) newScope[k] = v;
    }
    envStack.push(newScope);
    let result = null;
    try {
      evaluate(fn.body);
    } catch(e) {
      if (e instanceof EduPyReturn) { result = e.value; }
      else { envStack.pop(); throw e; }
    }
    envStack.pop();
    return result;
  }

  function instantiateClass(cls, args, kwargs) {
    const instance = { __type: "UserInstance", __className: cls.name, __class: cls };
    // Copy class attributes to instance
    if (cls.__classAttrs) {
      for (const [k,v] of Object.entries(cls.__classAttrs)) {
        instance[k] = v;
      }
    }
    // Bind methods
    // Call __init__ if exists
    if (cls.__methods && cls.__methods.__init__) {
      callMethod(instance, "__init__", args, kwargs);
    }
    return instance;
  }

  function callMethod(instance, methodName, args, kwargs={}) {
    if (instance.__class && instance.__class.__methods && instance.__class.__methods[methodName]) {
      const method = instance.__class.__methods[methodName];
      return callFn(method, [instance, ...args], kwargs);
    }
    // Check base class
    if (instance.__class && instance.__class.__baseClass) {
      const base = lookupVariable(instance.__class.__baseClass);
      if (base && base.__methods && base.__methods[methodName]) {
        return callFn(base.__methods[methodName], [instance, ...args], kwargs);
      }
    }
    throw new Error("AttributeError: '" + instance.__className + "' object has no method '" + methodName + "'");
  }

  // Re-assign global callMethod
  callMethod = (instance, methodName, args, kwargs={}) => {
    if (instance.__class && instance.__class.__methods && instance.__class.__methods[methodName]) {
      const method = instance.__class.__methods[methodName];
      return callUserFn(method, [instance, ...args], kwargs);
    }
    if (instance.__class && instance.__class.__baseClass) {
      try {
        const base = lookupVariable(instance.__class.__baseClass);
        if (base && base.__type === "UserClass" && base.__methods && base.__methods[methodName]) {
          return callUserFn(base.__methods[methodName], [instance, ...args], kwargs);
        }
      } catch(e) {}
    }
    throw new Error("AttributeError: '" + instance.__className + "' object has no method '" + methodName + "'");
  };

  function getAttr(obj, prop) {
    if (typeof obj === "string") return getStringMethod(obj, prop);
    if (Array.isArray(obj)) return getListMethod(obj, prop);
    if (obj && typeof obj === "object") {
      if (obj.__type === "UserInstance") {
        // Check own attrs first
        if (prop in obj && prop !== "__type" && prop !== "__className" && prop !== "__class") return obj[prop];
        // Check class methods
        if (obj.__class && obj.__class.__methods && prop in obj.__class.__methods) {
          const method = obj.__class.__methods[prop];
          // Return bound method
          return (...args) => callUserFn(method, [obj, ...args]);
        }
        // Check class attrs
        if (obj.__class && obj.__class.__classAttrs && prop in obj.__class.__classAttrs) {
          return obj.__class.__classAttrs[prop];
        }
        // Check base class
        if (obj.__class && obj.__class.__baseClass) {
          try {
            const base = lookupVariable(obj.__class.__baseClass);
            if (base && base.__type === "UserClass") {
              if (base.__methods && prop in base.__methods) {
                const method = base.__methods[prop];
                return (...args) => callUserFn(method, [obj, ...args]);
              }
              if (base.__classAttrs && prop in base.__classAttrs) return base.__classAttrs[prop];
            }
          } catch(e) {}
        }
        throw new Error("AttributeError: '" + obj.__className + "' object has no attribute '" + prop + "'");
      }
      if (obj.__type === "UserClass") {
        if (prop in obj) return obj[prop];
        if (obj.__classAttrs && prop in obj.__classAttrs) return obj.__classAttrs[prop];
        if (obj.__methods && prop in obj.__methods) {
          return (...args) => callUserFn(obj.__methods[prop], args);
        }
        throw new Error("AttributeError: class '" + obj.name + "' has no attribute '" + prop + "'");
      }
      if (prop in obj) return obj[prop];
      return getDictMethod(obj, prop);
    }
    throw new Error("AttributeError: unknown property '" + prop + "'");
  }

  function getStringMethod(s, prop) {
    const strMethods = {
      upper: () => s.toUpperCase(),
      lower: () => s.toLowerCase(),
      strip: (chars) => chars ? s.split("").filter(c=>!chars.includes(c)).join("") : s.trim(),
      lstrip: (chars) => chars ? s.replace(new RegExp("^["+escReg(chars)+"]+"), "") : s.trimStart(),
      rstrip: (chars) => chars ? s.replace(new RegExp("["+escReg(chars)+"]+$"), "") : s.trimEnd(),
      split: (sep, maxsplit) => {
        if (sep === null || sep === undefined) return s.trim().split(/\s+/).filter(Boolean);
        if (maxsplit !== undefined) {
          const parts=[];let rest=s;let count=0;
          while(count<maxsplit&&rest.indexOf(sep)!==-1){const i=rest.indexOf(sep);parts.push(rest.slice(0,i));rest=rest.slice(i+sep.length);count++;}
          parts.push(rest);return parts;
        }
        return s.split(sep);
      },
      rsplit: (sep, maxsplit) => {
        if(!sep){const arr=s.trim().split(/\s+/).filter(Boolean);return arr;}
        const parts=s.split(sep);
        if(maxsplit===undefined)return parts;
        const tail=parts.slice(-(maxsplit+1));
        const head=parts.slice(0,parts.length-maxsplit-1);
        return head.length?[head.join(sep),...tail]:tail;
      },
      splitlines: () => s.split(/\r?\n/),
      join: (iterable) => asArray(iterable).map(pyStr).join(s),
      replace: (old, newStr, count) => {
        if(count===undefined) return s.split(old).join(newStr);
        let r=s;let c=0;while(c<count){const i=r.indexOf(old);if(i<0)break;r=r.slice(0,i)+newStr+r.slice(i+old.length);c++;}return r;
      },
      find: (sub, start, end) => {
        const sl=start!==undefined?s.slice(start,end):s;
        const i=sl.indexOf(sub);return i<0?-1:i+(start||0);
      },
      rfind: (sub) => s.lastIndexOf(sub),
      index: (sub) => {
        const i=s.indexOf(sub);
        if(i<0)throw new Error("ValueError: substring not found");
        return i;
      },
      rindex: (sub) => {
        const i=s.lastIndexOf(sub);
        if(i<0)throw new Error("ValueError: substring not found");
        return i;
      },
      count: (sub) => {
        let count=0,pos=0;
        while((pos=s.indexOf(sub,pos))!==-1){count++;pos+=sub.length||1;}
        return count;
      },
      startswith: (prefix) => Array.isArray(prefix)?prefix.some(p=>s.startsWith(p)):s.startsWith(prefix),
      endswith: (suffix) => Array.isArray(suffix)?suffix.some(p=>s.endsWith(p)):s.endsWith(suffix),
      format: (...args) => pyFormatStr(s, args),
      format_map: (d) => s.replace(/\{([^}]*)\}/g, (_,k)=>d[k]!==undefined?pyStr(d[k]):""),
      zfill: (width) => s.padStart(width,"0"),
      center: (width, fillChar=" ") => s.padStart(Math.floor((width+s.length)/2),fillChar).padEnd(width,fillChar),
      ljust: (width, fillChar=" ") => s.padEnd(width, fillChar),
      rjust: (width, fillChar=" ") => s.padStart(width, fillChar),
      title: () => s.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\B\w/g,c=>c.toLowerCase()),
      capitalize: () => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
      swapcase: () => s.split("").map(c=>c===c.toUpperCase()?c.toLowerCase():c.toUpperCase()).join(""),
      expandtabs: (ts=8) => {
        let r="",col=0;
        for(const c of s){if(c==="\t"){const sp=ts-(col%ts);r+=" ".repeat(sp);col+=sp;}else{r+=c;col++;}}
        return r;
      },
      isdigit: () => /^[0-9]+$/.test(s),
      isalpha: () => /^[a-zA-Z]+$/.test(s),
      isalnum: () => /^[a-zA-Z0-9]+$/.test(s),
      isspace: () => /^\s+$/.test(s) && s.length>0,
      islower: () => s.length>0 && s===s.toLowerCase() && s!==s.toUpperCase(),
      isupper: () => s.length>0 && s===s.toUpperCase() && s!==s.toLowerCase(),
      istitle: () => /^(\s*[A-Z][a-z]*)*\s*$/.test(s),
      isidentifier: () => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s),
      encode: (enc="utf-8") => s, // simplified
      decode: () => s,
      partition: (sep) => {
        const i=s.indexOf(sep);
        if(i<0)return mkTuple([s,"",""]);
        return mkTuple([s.slice(0,i),sep,s.slice(i+sep.length)]);
      },
      rpartition: (sep) => {
        const i=s.lastIndexOf(sep);
        if(i<0)return mkTuple(["","",s]);
        return mkTuple([s.slice(0,i),sep,s.slice(i+sep.length)]);
      },
      removeprefix: (prefix) => s.startsWith(prefix)?s.slice(prefix.length):s,
      removesuffix: (suffix) => s.endsWith(suffix)?s.slice(0,-suffix.length):s,
      maketrans: () => ({}),
      translate: (table) => s,
    };
    if (prop === "length" || prop === "__len__") return () => s.length;
    if (prop in strMethods) return strMethods[prop];
    throw new Error("AttributeError: 'str' object has no attribute '" + prop + "'");
  }

  function escReg(s) { return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g,'\\$&'); }

  function getListMethod(arr, prop) {
    const listMethods = {
      append: (v) => { arr.push(v); return null; },
      extend: (other) => { arr.push(...asArray(other)); return null; },
      insert: (i, v) => { arr.splice(i, 0, v); return null; },
      remove: (v) => {
        const i=arr.findIndex(x=>pyEq(x,v));
        if(i<0) throw new Error("ValueError: list.remove(x): x not in list");
        arr.splice(i,1); return null;
      },
      pop: (i) => {
        if(arr.length===0) throw new Error("IndexError: pop from empty list");
        if(i===undefined) return arr.pop();
        const idx=i<0?arr.length+i:i;
        if(idx<0||idx>=arr.length) throw new Error("IndexError: pop index out of range");
        return arr.splice(idx,1)[0];
      },
      clear: () => { arr.splice(0, arr.length); return null; },
      index: (v, start, end) => {
        const sub=arr.slice(start||0,end);
        const i=sub.findIndex(x=>pyEq(x,v));
        if(i<0) throw new Error("ValueError: " + pyRepr(v) + " is not in list");
        return i+(start||0);
      },
      count: (v) => arr.filter(x=>pyEq(x,v)).length,
      sort: (key=null, reverse=false) => {
        // Unwrap keyword arguments passed as {__kwarg_key: ...} or {__kwarg_reverse: ...}
        if (key && typeof key === "object" && key.__kwarg_key !== undefined) { key = key.__kwarg_key; }
        if (key && typeof key === "object" && key.__kwarg_reverse !== undefined) { reverse = key.__kwarg_reverse; key = null; }
        if (reverse && typeof reverse === "object" && reverse.__kwarg_reverse !== undefined) { reverse = reverse.__kwarg_reverse; }
        if (reverse && typeof reverse === "object" && reverse.__kwarg_key !== undefined) { key = reverse.__kwarg_key; reverse = false; }
        arr.sort((a,b)=>{
          const ka=key?callFn(key,[a]):a;
          const kb=key?callFn(key,[b]):b;
          let r;
          if(typeof ka==="string"&&typeof kb==="string") r=ka.localeCompare(kb);
          else r=ka<kb?-1:ka>kb?1:0;
          return reverse?-r:r;
        });
        return null;
      },
      reverse: () => { arr.reverse(); return null; },
      copy: () => [...arr],
      __len__: () => arr.length,
    };
    if (prop === "length" || prop === "__len__") return () => arr.length;
    if (prop in listMethods) return listMethods[prop];
    throw new Error("AttributeError: 'list' object has no attribute '" + prop + "'");
  }

  function getDictMethod(obj, prop) {
    const dictMethods = {
      keys: () => Object.keys(obj).filter(k=>!k.startsWith("__")),
      values: () => Object.keys(obj).filter(k=>!k.startsWith("__")).map(k=>obj[k]),
      items: () => Object.keys(obj).filter(k=>!k.startsWith("__")).map(k=>mkTuple([k,obj[k]])),
      get: (key, def=null) => {
        const k=String(key);
        return Object.prototype.hasOwnProperty.call(obj,k)?obj[k]:def;
      },
      update: (other) => {
        if(other&&typeof other==="object")for(const k of Object.keys(other))obj[k]=other[k];
        return null;
      },
      pop: (key, def) => {
        const k=String(key);
        if(Object.prototype.hasOwnProperty.call(obj,k)){const v=obj[k];delete obj[k];return v;}
        if(def!==undefined)return def;
        throw new Error("KeyError: " + pyRepr(key));
      },
      setdefault: (key, def=null) => {
        const k=String(key);
        if(!Object.prototype.hasOwnProperty.call(obj,k)) obj[k]=def;
        return obj[k];
      },
      clear: () => { for(const k of Object.keys(obj)) delete obj[k]; return null; },
      copy: () => ({...obj}),
      has_key: (k) => Object.prototype.hasOwnProperty.call(obj, String(k)),
      fromkeys: (keys, val=null) => {
        const d={};
        for(const k of asArray(keys)) d[String(k)]=val;
        return d;
      },
      __len__: () => Object.keys(obj).filter(k=>!k.startsWith("__")).length,
    };
    if (prop in dictMethods) return dictMethods[prop];
    if (prop in obj) return obj[prop];
    throw new Error("AttributeError: 'dict' object has no attribute '" + prop + "'");
  }

  function pyEq(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v,i)=>pyEq(v,b[i]));
    }
    if (typeof a === "object" && typeof b === "object" && a!==null && b!==null) {
      const ka=Object.keys(a).filter(k=>!k.startsWith("__"));
      const kb=Object.keys(b).filter(k=>!k.startsWith("__"));
      if (ka.length!==kb.length) return false;
      return ka.every(k=>pyEq(a[k],b[k]));
    }
    return false;
  }

  function pyFormatStr(template, args) {
    let i=0;
    return template.replace(/\{([^}]*)\}/g, (_, spec) => {
      if (spec === "") return pyStr(args[i++]);
      if (/^\d+$/.test(spec)) return pyStr(args[parseInt(spec)]);
      if (spec.includes(":")) {
        const [ref, fmt] = spec.split(":", 2);
        const val = ref === "" ? args[i++] : (/^\d+$/.test(ref) ? args[parseInt(ref)] : args[i++]);
        return pyFormat(val, fmt);
      }
      return spec;
    });
  }

  function pyFormat(val, spec) {
    if (!spec) return pyStr(val);
    // e.g. ".2f", ">10", "<10.3f"
    const m = spec.match(/^([<>^]?)(\d*)(?:\.(\d+))?([dfeEgGsxXob%]?)$/);
    if (!m) return pyStr(val);
    const [_, align, width, prec, type] = m;
    let s;
    if (type === "f" || type === "F") s = Number(val).toFixed(prec !== undefined ? parseInt(prec) : 6);
    else if (type === "e") s = Number(val).toExponential(prec !== undefined ? parseInt(prec) : 6);
    else if (type === "E") s = Number(val).toExponential(prec !== undefined ? parseInt(prec) : 6).toUpperCase();
    else if (type === "g" || type === "G") s = prec !== undefined ? Number(val).toPrecision(parseInt(prec)) : String(Number(val));
    else if (type === "d") s = String(Math.trunc(Number(val)));
    else if (type === "x") s = Math.trunc(Number(val)).toString(16);
    else if (type === "X") s = Math.trunc(Number(val)).toString(16).toUpperCase();
    else if (type === "o") s = Math.trunc(Number(val)).toString(8);
    else if (type === "b") s = Math.trunc(Number(val)).toString(2);
    else if (type === "%") s = (Number(val)*100).toFixed(prec !== undefined ? parseInt(prec) : 6) + "%";
    else s = pyStr(val);
    if (width) {
      const w = parseInt(width);
      if (align === "<") s = s.padEnd(w);
      else if (align === ">") s = s.padStart(w);
      else if (align === "^") { const l=Math.floor((w-s.length)/2); s=" ".repeat(l)+s+" ".repeat(w-s.length-l); }
      else s = s.padStart(w);
    }
    return s;
  }

  function evalFString(raw) {
    // Parse f-string: replace {expr} with evaluated value
    return raw.replace(/\{([^{}]*)\}/g, (_, exprStr) => {
      // handle format spec {expr:spec}
      const colonIdx = exprStr.indexOf(":");
      let expr = exprStr, spec = "";
      if (colonIdx !== -1) {
        expr = exprStr.slice(0, colonIdx);
        spec = exprStr.slice(colonIdx + 1);
      }
      try {
        const toks = tokenize(expr.trim() + "\n");
        const parser = createParser(toks);
        const ast = { type: "Program", body: [{ type: "ExpressionStatement", expression: parser.parseProgram().body[0].expression }] };
        // mini-eval with current scope
        const val = evaluate(ast.body[0].expression);
        return spec ? pyFormat(val, spec) : pyStr(val);
      } catch (e) {
        return "{" + exprStr + "}";
      }
    });
  }

  let callDepth = 0;
  const MAX_DEPTH = 500;

  function evaluate(node) {
    if (!node) return null;
    switch (node.type) {

      case "Program":
        for (const stmt of node.body) evaluate(stmt);
        return null;

      case "BlockStatement":
        for (const stmt of node.body) evaluate(stmt);
        return null;

      case "PassStatement":
        return null;

      case "GlobalStatement":
        for (const name of node.names) globalVars.add(name);
        return null;

      case "AssignmentStatement": {
        const val = evaluate(node.value);
        const target = node.target;
        if (!target) return null;
        if (target.type === "Identifier") {
          assignVariable(target.name, val);
        } else if (target.type === "IndexExpression") {
          const obj = evaluate(target.array);
          const idx = evaluate(target.index);
          if (Array.isArray(obj)) {
            let i = idx|0;
            if (i < 0) i = obj.length + i;
            obj[i] = val;
          } else if (obj && typeof obj === "object") {
            obj[String(idx)] = val;
          } else {
            throw new Error("TypeError: object does not support item assignment");
          }
        } else if (target.type === "PropertyAccess") {
          const obj = evaluate(target.object);
          if (!obj || typeof obj !== "object") throw new Error("AttributeError: cannot set attribute on " + typeof obj);
          obj[target.property] = val;
        }
        return val;
      }

      case "AugmentedAssignment": {
        const target = node.target;
        let currentVal;
        if (target.type === "Identifier") currentVal = lookupVariable(target.name);
        else if (target.type === "IndexExpression") {
          const obj = evaluate(target.array);
          const idx = evaluate(target.index);
          currentVal = Array.isArray(obj) ? obj[idx<0?obj.length+idx:idx] : obj[String(idx)];
        } else if (target.type === "PropertyAccess") {
          const obj = evaluate(target.object);
          currentVal = obj[target.property];
        }
        const rhs = evaluate(node.value);
        let newVal;
        switch (node.operator) {
          case "+=": newVal = (typeof currentVal==="string"||typeof rhs==="string") ? String(currentVal)+String(rhs) : currentVal+rhs; break;
          case "-=": newVal = currentVal - rhs; break;
          case "*=": newVal = currentVal * rhs; break;
          case "/=": newVal = currentVal / rhs; break;
          case "%=": newVal = currentVal % rhs; break;
          case "**=": newVal = Math.pow(currentVal, rhs); break;
          case "//=": newVal = Math.floor(currentVal / rhs); break;
          default: newVal = currentVal;
        }
        if (target.type === "Identifier") assignVariable(target.name, newVal);
        else if (target.type === "IndexExpression") {
          const obj = evaluate(target.array);
          const idx = evaluate(target.index);
          if (Array.isArray(obj)) obj[idx<0?obj.length+idx:idx]=newVal;
          else obj[String(idx)]=newVal;
        } else if (target.type === "PropertyAccess") {
          const obj = evaluate(target.object);
          obj[target.property]=newVal;
        }
        return newVal;
      }

      case "TupleUnpackStatement": {
        const val = evaluate(node.value);
        const arr = asArray(val);
        for (let i = 0; i < node.targets.length; i++) {
          assignVariable(node.targets[i], arr[i] !== undefined ? arr[i] : null);
        }
        return null;
      }

      case "FunctionDeclaration": {
        const fn = {
          __type: "UserFunction",
          name: node.name,
          params: node.params,
          defaults: node.defaults || {},
          hasVarargs: node.hasVarargs,
          varargsName: node.varargsName,
          hasKwargs: node.hasKwargs,
          kwargsName: node.kwargsName,
          body: node.body,
          closure: envStack.map(s => s), // capture closure
        };
        defineVariable(node.name, fn);
        return fn;
      }

      case "ClassDeclaration": {
        const cls = {
          __type: "UserClass",
          name: node.name,
          __baseClass: node.baseClass,
          __methods: {},
          __classAttrs: {},
        };
        // Execute class body in a special scope to collect methods and class attrs
        const classScope = Object.create(null);
        classScope.__currentClass = cls;
        envStack.push(classScope);
        try {
          evaluate(node.body);
          // collect methods and attrs from classScope
          for (const [k,v] of Object.entries(classScope)) {
            if (k.startsWith("__") && k.endsWith("__") && k !== "__currentClass") {
              if (v && v.__type === "UserFunction") cls.__methods[k] = v;
              else cls.__classAttrs[k] = v;
            } else if (v && v.__type === "UserFunction") {
              cls.__methods[k] = v;
            } else if (k !== "__currentClass") {
              cls.__classAttrs[k] = v;
            }
          }
        } finally {
          envStack.pop();
        }
        defineVariable(node.name, cls);
        return cls;
      }

      case "ReturnStatement":
        throw new EduPyReturn(evaluate(node.argument));

      case "BreakStatement":
        throw new EduPyBreak();

      case "ContinueStatement":
        throw new EduPyContinue();

      case "AssertStatement": {
        const cond = evaluate(node.test);
        if (!truthy(cond)) {
          const msg = node.msg ? pyStr(evaluate(node.msg)) : "assertion failed";
          throw new Error("AssertionError: " + msg);
        }
        return null;
      }

      case "RaiseStatement": {
        if (!node.expression) throw new Error("RuntimeError");
        const exc = evaluate(node.expression);
        if (typeof exc === "string") throw new Error(exc);
        if (exc && exc.message) throw new Error(exc.message);
        if (typeof exc === "function") throw new Error(exc().message || "Error");
        throw new Error(pyStr(exc));
      }

      case "DelStatement": {
        const target = node.target;
        if (target.type === "Identifier") {
          for (let i = envStack.length-1; i>=0; i--) {
            if (Object.prototype.hasOwnProperty.call(envStack[i], target.name)) {
              delete envStack[i][target.name]; break;
            }
          }
        } else if (target.type === "IndexExpression") {
          const obj = evaluate(target.array);
          const idx = evaluate(target.index);
          if (Array.isArray(obj)) obj.splice(idx<0?obj.length+idx:idx, 1);
          else delete obj[String(idx)];
        }
        return null;
      }

      case "ExpressionStatement":
        return evaluate(node.expression);

      case "IfStatement": {
        if (truthy(evaluate(node.test))) evaluate(node.consequent);
        else if (node.alternate) evaluate(node.alternate);
        return null;
      }

      case "WhileStatement": {
        let didBreak = false;
        while (truthy(evaluate(node.test))) {
          try {
            evaluate(node.body);
          } catch(e) {
            if (e instanceof EduPyBreak) { didBreak=true; break; }
            if (e instanceof EduPyContinue) continue;
            throw e;
          }
        }
        if (!didBreak && node.elseBlock) evaluate(node.elseBlock);
        return null;
      }

      case "ForStatement": {
        const iterVal = evaluate(node.iterable);
        let iterArr = asArray(iterVal);
        let didBreak = false;
        for (const item of iterArr) {
          if (node.iterVars.length === 1) {
            assignVariable(node.iterVars[0], item);
          } else {
            // tuple unpack
            const vals = asArray(item);
            for (let i = 0; i < node.iterVars.length; i++) {
              assignVariable(node.iterVars[i], vals[i] !== undefined ? vals[i] : null);
            }
          }
          try {
            evaluate(node.body);
          } catch(e) {
            if (e instanceof EduPyBreak) { didBreak=true; break; }
            if (e instanceof EduPyContinue) continue;
            throw e;
          }
        }
        if (!didBreak && node.elseBlock) evaluate(node.elseBlock);
        return null;
      }

      case "TryStatement": {
        let caught = false;
        try {
          evaluate(node.tryBlock);
        } catch(e) {
          if (e instanceof EduPyReturn || e instanceof EduPyBreak || e instanceof EduPyContinue) throw e;
          // Find matching handler
          let handled = false;
          for (const handler of node.handlers) {
            if (handler.excType === null) {
              // bare except
              if (handler.excName) assignVariable(handler.excName, { message: e.message || String(e), __type: "Exception" });
              evaluate(handler.body);
              handled = true;
              break;
            }
            // type match — simplified: always match for now
            if (handler.excName) assignVariable(handler.excName, { message: e.message || String(e), __type: "Exception" });
            evaluate(handler.body);
            handled = true;
            break;
          }
          if (!handled) throw e;
        } finally {
          if (node.finallyBlock) evaluate(node.finallyBlock);
        }
        return null;
      }

      case "ImportStatement": {
        for (const name of node.names) {
          if (modules[name]) defineVariable(name, modules[name]);
          else outputFn("# Warning: module '" + name + "' not available in EduPy");
        }
        return null;
      }

      case "FromImportStatement": {
        const mod = modules[node.module];
        if (!mod) { outputFn("# Warning: module '" + node.module + "' not available in EduPy"); return null; }
        if (node.names[0] === "*") {
          for (const [k,v] of Object.entries(mod)) if (!k.startsWith("__")) defineVariable(k,v);
        } else {
          for (const name of node.names) {
            if (name in mod) defineVariable(name, mod[name]);
            else outputFn("# Warning: '" + name + "' not in module '" + node.module + "'");
          }
        }
        return null;
      }

      // Literals
      case "NumericLiteral": return node.value;
      case "BooleanLiteral": return node.value;
      case "NullLiteral": return null;
      case "StringLiteral": return node.value;
      case "FStringLiteral": return evalFString(node.raw);

      case "ArrayLiteral":
        return node.elements.map(evaluate);

      case "TupleLiteral":
        return mkTuple(node.elements.map(evaluate));

      case "SetLiteral":
        return mkSet([...new Set(node.elements.map(evaluate).map(v=>JSON.stringify(v)))].map(v=>JSON.parse(v)));

      case "DictLiteral": {
        const obj = {};
        for (const entry of node.entries) {
          if (entry.splat) {
            const other = evaluate(entry.splat.value);
            if (other && typeof other === "object") Object.assign(obj, other);
          } else {
            const k = String(evaluate(entry.key));
            obj[k] = evaluate(entry.value);
          }
        }
        return obj;
      }

      case "ListComprehension": {
        const result = [];
        const iterVal = evaluate(node.iterable);
        const iterArr = asArray(iterVal);
        for (const item of iterArr) {
          if (node.iterVars.length === 1) {
            assignVariable(node.iterVars[0], item);
          } else {
            const vals = asArray(item);
            for (let i = 0; i < node.iterVars.length; i++) assignVariable(node.iterVars[i], vals[i]||null);
          }
          if (node.filter && !truthy(evaluate(node.filter))) continue;
          result.push(evaluate(node.expression));
        }
        return result;
      }

      case "Identifier":
        return lookupVariable(node.name);

      case "LambdaExpression": {
        const params = node.params;
        const body = node.body;
        const fn = {
          __type: "UserFunction",
          name: "<lambda>",
          params,
          defaults: {},
          hasVarargs: false,
          hasKwargs: false,
          body: { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: body }] },
        };
        return fn;
      }

      case "TernaryExpression": {
        const cond = evaluate(node.condition);
        return truthy(cond) ? evaluate(node.consequent) : evaluate(node.alternate);
      }

      case "WalrusExpression": {
        const val = evaluate(node.value);
        assignVariable(node.name, val);
        return val;
      }

      case "UnaryExpression": {
        const arg = evaluate(node.argument);
        switch (node.operator) {
          case "not": return !truthy(arg);
          case "-": return -arg;
          case "+": return +arg;
          case "~": return ~arg;
          default: throw new Error("RuntimeError: unknown unary op '" + node.operator + "'");
        }
      }

      case "BinaryExpression": {
        // Short-circuit for and/or
        if (node.operator === "and") {
          const l = evaluate(node.left);
          return truthy(l) ? evaluate(node.right) : l;
        }
        if (node.operator === "or") {
          const l = evaluate(node.left);
          return truthy(l) ? l : evaluate(node.right);
        }

        const left = evaluate(node.left);
        const right = evaluate(node.right);

        switch (node.operator) {
          case "+":
            if (typeof left === "string" || typeof right === "string") return String(left===null?"None":left) + String(right===null?"None":right);
            if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
            return left + right;
          case "-": return left - right;
          case "*":
            if (typeof left === "string" && typeof right === "number") return left.repeat(Math.max(0,right|0));
            if (typeof right === "string" && typeof left === "number") return right.repeat(Math.max(0,left|0));
            if (Array.isArray(left) && typeof right === "number") {
              const r=[]; for(let i=0;i<(right|0);i++) r.push(...left); return r;
            }
            return left * right;
          case "/": {
            if (right === 0) throw new Error("ZeroDivisionError: division by zero");
            return left / right;
          }
          case "//": {
            if (right === 0) throw new Error("ZeroDivisionError: integer division or modulo by zero");
            return Math.floor(left / right);
          }
          case "%": {
            if (typeof left === "string") return pyFormatStr(left, Array.isArray(right)?right:[right]);
            return left % right;
          }
          case "**": return Math.pow(left, right);
          case "==": return pyEq(left, right);
          case "!=": return !pyEq(left, right);
          case "<": return left < right;
          case ">": return left > right;
          case "<=": return left <= right;
          case ">=": return left >= right;
          case "is": return left === right;
          case "is not": return left !== right;
          case "in":
            if (typeof right === "string") return right.includes(String(left));
            if (Array.isArray(right)) return right.some(v=>pyEq(v,left));
            if (right && typeof right === "object") return Object.prototype.hasOwnProperty.call(right, String(left));
            return false;
          case "not in":
            if (typeof right === "string") return !right.includes(String(left));
            if (Array.isArray(right)) return !right.some(v=>pyEq(v,left));
            if (right && typeof right === "object") return !Object.prototype.hasOwnProperty.call(right, String(left));
            return true;
          case "|": return (left|0) | (right|0);
          case "&": return (left|0) & (right|0);
          default:
            throw new Error("RuntimeError: unknown operator '" + node.operator + "'");
        }
      }

      case "IndexExpression": {
        const obj = evaluate(node.array);
        const rawIdx = evaluate(node.index);

        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          const key = typeof rawIdx === "string" ? rawIdx : String(rawIdx);
          if (!Object.prototype.hasOwnProperty.call(obj, key)) throw new Error("KeyError: " + pyRepr(rawIdx));
          return obj[key];
        }

        let idx = rawIdx;
        if (typeof idx !== "number") idx = parseInt(idx, 10);
        idx = idx|0;

        if (typeof obj === "string" || Array.isArray(obj)) {
          const len = obj.length;
          if (idx < 0) idx = len + idx;
          if (idx < 0 || idx >= len) throw new Error("IndexError: index " + rawIdx + " out of range");
          return typeof obj === "string" ? obj.charAt(idx) : obj[idx];
        }

        throw new Error("TypeError: object is not subscriptable");
      }

      case "SliceExpression": {
        const obj = evaluate(node.array);
        if (typeof obj !== "string" && !Array.isArray(obj)) throw new Error("TypeError: slicing not supported on " + typeof obj);
        const len = obj.length;
        let start = node.start !== null && node.start !== undefined ? (evaluate(node.start)*1)|0 : null;
        let end = node.end !== null && node.end !== undefined ? (evaluate(node.end)*1)|0 : null;
        let step = node.step !== null && node.step !== undefined ? (evaluate(node.step)*1)|0 : 1;
        if (step === 0) throw new Error("ValueError: slice step cannot be zero");
        if (step > 0) {
          if (start===null) start=0;
          if (end===null) end=len;
          if (start<0) start=Math.max(0,len+start);
          if (end<0) end=Math.max(0,len+end);
          start=Math.max(0,Math.min(start,len));
          end=Math.max(0,Math.min(end,len));
        } else {
          if (start===null) start=len-1;
          if (end===null) end=-len-1;
          if (start<0) start=len+start;
          if (end<0) end=len+end;
          start=Math.max(-1,Math.min(start,len-1));
          end=Math.max(-1,Math.min(end,len-1));
        }
        const result=[];
        if (step>0) for(let i=start;i<end;i+=step) result.push(obj[i]);
        else for(let i=start;i>end;i+=step) result.push(obj[i]);
        return typeof obj === "string" ? result.join("") : result;
      }

      case "PropertyAccess": {
        const obj = evaluate(node.object);
        return getAttr(obj, node.property);
      }

      case "CallExpression": {
        if (callDepth > MAX_DEPTH) throw new Error("RecursionError: maximum recursion depth exceeded");
        callDepth++;
        try {
          // Evaluate callee
          let fn;
          const kwargs = {};

          // Collect kwargs from args
          const rawArgs = [];
          for (const arg of node.arguments) {
            if (arg.type === "Splat") {
              const splatted = asArray(evaluate(arg.value));
              rawArgs.push(...splatted);
            } else if (arg.type === "DoubleSplat") {
              const splatted = evaluate(arg.value);
              Object.assign(kwargs, splatted);
            } else {
              rawArgs.push(evaluate(arg));
            }
          }
          if (node.kwargs) {
            for (const [k,v] of Object.entries(node.kwargs)) kwargs[k] = evaluate(v);
          }

          // Special handling for method calls to pass sep/end to print
          if (node.callee.type === "Identifier" && node.callee.name === "print" && Object.keys(kwargs).length > 0) {
            fn = lookupVariable("print");
            const kwObjs = Object.entries(kwargs).map(([k,v])=>({["__kwarg_"+k]:v}));
            const result = fn(...rawArgs, ...kwObjs);
            return result;
          }

          fn = evaluate(node.callee);
          return callFn(fn, rawArgs, kwargs);
        } finally {
          callDepth--;
        }
      }

      default:
        throw new Error("RuntimeError: unknown AST node: " + node.type);
    }
  }

  return { run: (prog) => evaluate(prog) };
}

// ==================== UI + CODEMIRROR INTEGRATION ==================

window.addEventListener("DOMContentLoaded", () => {

  const demoProgram = `# EduPy v2.0 - Full Python Interpreter Demo

# --- Variables & Math ---
x = 10
y = 3.14
name = "EduPy"
print("Hello from", name)
print("x =", x, "| y =", y)
print("x ** 2 =", x ** 2)
print("x // 3 =", x // 3)
print("x % 3 =", x % 3)

# --- f-strings ---
age = 20
print(f"Age is {age} and pi is {3.14159:.2f}")



`;

  // ── File Manager ──────────────────────────────────────────────────────
  const STORAGE_KEY = "edupy-autosave-v3";
  let files = [{ id: 0, name: "untitled.py", content: demoProgram }];
  let activeFileId = 0;
  let nextId = 1;

  function saveAllToStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, activeFileId, nextId })); } catch(e){}
    
    // Sync to Firestore if user is authenticated
    if (window.auth && window.auth.currentUser && window.db) {
      const uid = window.auth.currentUser.uid;
      window.db.collection('users').doc(uid).update({
        editorFiles: { files, activeFileId, nextId }
      }).catch(err => console.error("Firestore autosave error:", err));
    }
  }

  function loadFromStorage() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.files) && saved.files.length > 0) {
        files = saved.files;
        activeFileId = saved.activeFileId;
        nextId = saved.nextId || (Math.max(...files.map(f => f.id)) + 1);
        return true;
      }
    } catch(e) {}
    return false;
  }

  // Real-time synchronization of files from Firestore
  if (window.firebaseReady) {
    window.firebaseReady.then(() => {
      window.auth.onAuthStateChanged(async (user) => {
        if (user) {
          try {
            const doc = await window.db.collection('users').doc(user.uid).get();
            if (doc.exists) {
              const data = doc.data();
              if (data.editorFiles && Array.isArray(data.editorFiles.files) && data.editorFiles.files.length > 0) {
                files = data.editorFiles.files;
                activeFileId = data.editorFiles.activeFileId;
                nextId = data.editorFiles.nextId || (Math.max(...files.map(f => f.id)) + 1);
                
                // Update CodeMirror with the active file contents
                const activeFile = files.find(f => f.id === activeFileId) || files[0];
                editor.setValue(activeFile ? activeFile.content : demoProgram);
                renderTabs();
                updateLines();
              } else {
                // If cloud is empty, upload current local state
                saveAllToStorage();
              }
            }
          } catch (error) {
            console.error("Firestore load editor files failed:", error);
          }
        }
      });
    });
  }

  // ── CodeMirror init ────────────────────────────────────────────────────
  const codeTextarea = document.getElementById("code");
  const editor = CodeMirror.fromTextArea(codeTextarea, {
    lineNumbers: true,
    mode: "python",
    theme: "monokai",
    tabSize: 4,
    indentUnit: 4,
    indentWithTabs: false,
    smartIndent: true,
    extraKeys: { "Ctrl-Enter": runCurrentCode, "Cmd-Enter": runCurrentCode },
  });

  // ── Load initial state ─────────────────────────────────────────────────
  const urlParams = new URLSearchParams(location.search);
  const sharedCode = urlParams.get("code");
  const sessionRunCode = sessionStorage.getItem('edupy_run_code');
  
  if (sharedCode) {
    try {
      const dec = (s) => decodeURIComponent(escape(atob(s.replace(/-/g,"+").replace(/_/g,"/"))));
      files = [{ id: 0, name: "shared.py", content: dec(sharedCode) }];
      activeFileId = 0; nextId = 1;
      history.replaceState({}, "", location.pathname);
    } catch(e) {}
  } else if (sessionRunCode) {
    loadFromStorage();
    const newId = nextId++;
    files.push({ id: newId, name: "playground.py", content: sessionRunCode });
    activeFileId = newId;
    saveAllToStorage();
    sessionStorage.removeItem('edupy_run_code');
  } else {
    loadFromStorage();
  }

  renderTabs();
  const initFile = files.find(f => f.id === activeFileId) || files[0];
  editor.setValue(initFile ? initFile.content : demoProgram);
  editor.focus();

  // ── Tab rendering ──────────────────────────────────────────────────────
  function renderTabs() {
    const tabBar = document.getElementById("fileTabs");
    tabBar.innerHTML = "";

    files.forEach(file => {
      const tab = document.createElement("div");
      tab.className = "file-tab" + (file.id === activeFileId ? " active" : "");
      tab.dataset.id = file.id;

      const icon = document.createElementNS("http://www.w3.org/2000/svg","svg");
      icon.setAttribute("viewBox","0 0 24 24"); icon.setAttribute("fill","none");
      icon.setAttribute("stroke","currentColor"); icon.setAttribute("stroke-width","2");
      icon.setAttribute("stroke-linecap","round"); icon.setAttribute("stroke-linejoin","round");
      icon.setAttribute("width","11"); icon.setAttribute("height","11");
      icon.innerHTML = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';

      const nameSpan = document.createElement("span");
      nameSpan.className = "tab-name";
      nameSpan.textContent = file.name;
      nameSpan.title = "Double-click to rename";
      nameSpan.addEventListener("dblclick", (e) => { e.stopPropagation(); startRename(nameSpan, file); });

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.innerHTML = "×";
      closeBtn.title = "Close tab";
      closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeFile(file.id); });

      tab.addEventListener("click", () => switchFile(file.id));
      tab.appendChild(icon);
      tab.appendChild(nameSpan);
      tab.appendChild(closeBtn);
      tabBar.appendChild(tab);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "tab-add-btn";
    addBtn.innerHTML = "+";
    addBtn.title = "New file (Ctrl+N)";
    addBtn.addEventListener("click", addNewFile);
    tabBar.appendChild(addBtn);
  }

  function startRename(span, file) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tab-name-input";
    input.value = file.name;
    span.replaceWith(input);
    input.focus();
    input.select();
    const finish = () => {
      let newName = input.value.trim() || file.name;
      if (!/\.(py|txt|edupy)$/i.test(newName)) newName += ".py";
      file.name = newName;
      saveAllToStorage();
      renderTabs();
    };
    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { input.value = file.name; input.blur(); }
    });
  }

  function switchFile(id) {
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = editor.getValue();
    activeFileId = id;
    const target = files.find(f => f.id === id);
    if (target) editor.setValue(target.content);
    saveAllToStorage();
    renderTabs();
    updateLines();
    editor.focus();
  }

  function closeFile(id) {
    if (files.length === 1) { showToast("Can't close the last file", "error"); return; }
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = editor.getValue();
    const idx = files.findIndex(f => f.id === id);
    files.splice(idx, 1);
    if (activeFileId === id) {
      const nf = files[Math.min(idx, files.length - 1)];
      activeFileId = nf.id;
      editor.setValue(nf.content);
    }
    saveAllToStorage(); renderTabs(); updateLines();
  }

  function addNewFile() {
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = editor.getValue();
    const id = nextId++;
    const newFile = { id, name: `file${files.length + 1}.py`, content: "# New file\n" };
    files.push(newFile);
    activeFileId = id;
    saveAllToStorage();
    renderTabs();
    editor.setValue(newFile.content);
    editor.focus();
    updateLines();
    // Auto-trigger rename
    setTimeout(() => {
      const allTabs = document.querySelectorAll(".file-tab");
      const last = allTabs[allTabs.length - 1];
      if (last) {
        const ns = last.querySelector(".tab-name");
        if (ns) startRename(ns, newFile);
      }
    }, 40);
  }

  // ── Terminal ────────────────────────────────────────────────────────────
  const outputEl = document.getElementById("output");
  const errorsEl = document.getElementById("errors");
  const astEl    = document.getElementById("ast");
  let activeTermTab = "output";

  function switchTermTab(tab) {
    activeTermTab = tab;
    document.querySelectorAll(".term-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".term-pane").forEach(p => p.classList.toggle("active", p.id === tab));
  }

  function updateProblemsBadge(hasError) {
    const btn = document.querySelector('.term-tab[data-tab="errors"]');
    if (!btn) return;
    let badge = btn.querySelector(".problems-badge");
    if (hasError) {
      if (!badge) { badge = document.createElement("span"); badge.className = "problems-badge"; btn.appendChild(badge); }
      badge.textContent = "1";
    } else {
      if (badge) badge.remove();
    }
  }

  document.querySelectorAll(".term-tab").forEach(b => b.addEventListener("click", () => switchTermTab(b.dataset.tab)));

  document.getElementById("clearTerminal").addEventListener("click", () => {
    outputEl.innerHTML = '<span class="ph">Output will appear here…</span>';
    errorsEl.innerHTML = '<span class="ph">No errors 🎉</span>';
    astEl.innerHTML    = '<span class="ph">Run code to see AST…</span>';
    updateProblemsBadge(false);
    const ts = document.getElementById("termTimestamp");
    if (ts) ts.textContent = "";
  });

  // ── Run code ────────────────────────────────────────────────────────────
  function runCurrentCode() {
    const code = editor.getValue();
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = code;
    saveAllToStorage();

    const outputLines = [];
    const addLine = (line) => outputLines.push(line);
    const t0 = Date.now();

    try {
      const tokens = tokenize(code);
      const parser = createParser(tokens);
      const ast = parser.parseProgram();
      astEl.textContent = JSON.stringify(ast, null, 2);

      const interp = createInterpreter(addLine);
      interp.run(ast);

      const ms = Date.now() - t0;
      outputEl.innerHTML = outputLines.length === 0
        ? '<span class="ph">Code ran successfully (no output)</span>'
        : "";
      if (outputLines.length > 0) outputEl.textContent = outputLines.join("\n");
      errorsEl.innerHTML = '<span class="ph">No errors 🎉</span>';
      setTimestamp(ms, false);
      updateProblemsBadge(false);
      switchTermTab("output");

    } catch (err) {
      const ms = Date.now() - t0;
      const msg = String(err.message || err);
      errorsEl.innerHTML = `<span class="err-icon">⚠</span>${msg}`;
      outputEl.innerHTML = '<span class="ph">Execution stopped due to error</span>';
      astEl.innerHTML = '<span class="ph">Run code to see AST…</span>';
      setTimestamp(ms, true);
      updateProblemsBadge(true);
      switchTermTab("errors");
    }
    updateLines();
  }

  function setTimestamp(ms, isError) {
    const el = document.getElementById("termTimestamp");
    if (!el) return;
    el.textContent = `${isError ? "⚠ Error" : "✓ Done"} · ${ms}ms · ${new Date().toLocaleTimeString()}`;
    el.style.color = isError ? "var(--c-error)" : "var(--accent)";
  }

  // ── Buttons ────────────────────────────────────────────────────────────
  document.getElementById("runBtn").addEventListener("click", runCurrentCode);

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("Clear the current file? All code will be erased.")) return;
    editor.setValue("");
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = "";
    saveAllToStorage(); updateLines(); showToast("Editor cleared");
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("Reset to demo code?")) return;
    editor.setValue(demoProgram);
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = demoProgram;
    saveAllToStorage(); updateLines(); showToast("Reset to demo");
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    const code = editor.getValue();
    const cur = files.find(f => f.id === activeFileId);
    const def = cur ? cur.name : "untitled.py";
    let name = prompt("Save as:", def);
    if (name === null) return;
    name = name.trim() || def;
    if (!/\.(py|txt|edupy)$/i.test(name)) name += ".py";
    const blob = new Blob([code], { type: "text/x-python;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast("File saved!");
  });

  const openBtn = document.getElementById("openBtn");
  const fileInput = document.getElementById("fileInput");
  openBtn.addEventListener("click", () => { fileInput.setAttribute("multiple",""); fileInput.click(); });
  fileInput.addEventListener("change", (e) => {
    const flist = Array.from(e.target.files);
    if (!flist.length) return;
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = editor.getValue();
    let done = 0, lastId = null;
    flist.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const id = nextId++;
        files.push({ id, name: file.name, content: ev.target.result });
        lastId = id;
        if (++done === flist.length) {
          activeFileId = lastId;
          editor.setValue(files[files.length - 1].content);
          saveAllToStorage(); renderTabs(); updateLines();
          showToast(`${flist.length > 1 ? flist.length + " files" : "File"} opened!`);
        }
      };
      reader.readAsText(file);
    });
    fileInput.value = "";
  });

  document.getElementById("shareBtn").addEventListener("click", () => {
    const encode = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const url = location.origin + location.pathname + "?code=" + encode(editor.getValue());
    navigator.clipboard.writeText(url).then(() => showToast("Share link copied!")).catch(() => prompt("Copy this link:", url));
  });

  // ── Quick Reference Toggle ──────────────────────────────────────────────
  const quickRef = document.getElementById("quickRef");
  let qrOpen = false;
  function toggleQuickRef() {
    qrOpen = !qrOpen;
    quickRef.classList.toggle("open", qrOpen);
    document.querySelectorAll(".quick-ref-btn").forEach(btn => {
      btn.classList.toggle("active", qrOpen);
      const lbl = btn.querySelector(".qr-label");
      if (lbl) lbl.textContent = qrOpen ? "Hide Reference" : "Quick Reference";
      const chev = btn.querySelector(".qr-chevron");
      if (chev) chev.style.transform = qrOpen ? "rotate(180deg)" : "rotate(0deg)";
    });
    if (qrOpen) quickRef.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  document.querySelectorAll(".quick-ref-btn").forEach(btn => btn.addEventListener("click", toggleQuickRef));

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runCurrentCode(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "n")     { e.preventDefault(); addNewFile(); }
  });

  // ── Line count ──────────────────────────────────────────────────────────
  const lineEl = document.getElementById("lineCount");
  function updateLines() {
    const n = editor.lineCount();
    const cur = editor.getCursor();
    lineEl.textContent = `Ln ${cur.line + 1}:${cur.ch + 1} · ${n} ${n === 1 ? "line" : "lines"}`;
  }
  editor.on("cursorActivity", updateLines);
  editor.on("change", updateLines);
  updateLines();

  // ── Autosave ────────────────────────────────────────────────────────────
  setInterval(() => {
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = editor.getValue();
    saveAllToStorage();
  }, 3000);
  window.addEventListener("beforeunload", () => {
    const cur = files.find(f => f.id === activeFileId);
    if (cur) cur.content = editor.getValue();
    saveAllToStorage();
  });

  // ── Toast ────────────────────────────────────────────────────────────────
  function showToast(msg, type = "success") {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast " + type + " show";
    setTimeout(() => t.classList.remove("show"), 2800);
  }
  window.__showToast = showToast;

  // ── Cheat cards ──────────────────────────────────────────────────────────
  document.querySelectorAll(".cheat-card[data-copy]").forEach(card => {
    const h = () => {
      const code = card.querySelector("code").textContent;
      navigator.clipboard.writeText(code)
        .then(() => { showToast("Snippet copied!"); card.classList.add("copied"); setTimeout(() => card.classList.remove("copied"), 1000); })
        .catch(() => showToast("Copy failed", "error"));
    };
    card.addEventListener("click", h);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") h(); });
  });

  // ── Mobile drawer run button ──────────────────────────────────────────────
  const drawerRunBtn = document.getElementById("drawerRunBtn");
  if (drawerRunBtn) drawerRunBtn.addEventListener("click", () => { runCurrentCode(); });

});