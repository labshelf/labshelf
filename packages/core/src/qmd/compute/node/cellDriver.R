# Persistent cell driver: reads one JSON request per stdin line and keeps one session (the global environment) for the life of the process.
# Each response is a line "\u0001LABSHELF\u0001" + JSON {id, text|error}; anything the cell prints goes to stdout before it.
# Run as: Rscript --vanilla cellDriver.R. Base R only: no package is loaded, so the driver needs no installed library.

# The driver's own functions and constants live in a private environment, so a cell or a param can never see or replace them.
local({
driver <- environment()

SENTINEL <- "\001LABSHELF\001"

# The request is parsed on code points so the driver does not depend on the locale Rscript starts with.
parse_json_line <- function(line) {
  cp <- utf8ToInt(line)
  n <- length(cp)
  pos <- 1L
  skip <- function() { while (pos <= n && cp[pos] %in% c(32L, 9L, 10L, 13L)) pos <<- pos + 1L }
  hex4 <- function() {
    value <- strtoi(intToUtf8(cp[pos:(pos + 3L)]), 16L)
    if (is.na(value)) stop("bad escape")
    pos <<- pos + 4L
    value
  }
  read_string <- function() {
    pos <<- pos + 1L
    out <- integer(0)
    repeat {
      if (pos > n) stop("unterminated string")
      ch <- cp[pos]
      if (ch == 34L) { pos <<- pos + 1L; break }
      if (ch == 92L) {
        esc <- cp[pos + 1L]
        pos <<- pos + 2L
        if (is.na(esc)) stop("bad escape")
        mapped <- switch(intToUtf8(esc), n = 10L, t = 9L, r = 13L, b = 8L, f = 12L, `/` = 47L, `\\` = 92L, `"` = 34L, NULL)
        if (!is.null(mapped)) {
          out <- c(out, mapped)
        } else if (esc == 117L) {
          unit <- hex4()
          if (unit >= 55296L && unit <= 56319L && pos + 1L <= n && cp[pos] == 92L && cp[pos + 1L] == 117L) {
            pos <<- pos + 2L
            low <- hex4()
            unit <- 65536L + (unit - 55296L) * 1024L + (low - 56320L)
          }
          out <- c(out, unit)
        } else {
          stop("bad escape")
        }
      } else {
        out <- c(out, ch)
        pos <<- pos + 1L
      }
    }
    if (length(out) == 0L) "" else intToUtf8(out)
  }
  read_value <- function() {
    skip()
    if (pos > n) stop("unexpected end")
    ch <- cp[pos]
    if (ch == 34L) return(read_string())
    if (ch == 123L) return(read_object())
    if (ch == 91L) return(read_array())
    start <- pos
    while (pos <= n && !(cp[pos] %in% c(44L, 125L, 93L, 32L, 9L, 10L, 13L))) pos <<- pos + 1L
    token <- intToUtf8(cp[start:(pos - 1L)])
    if (token == "true") return(TRUE)
    if (token == "false") return(FALSE)
    if (token == "null") return(NULL)
    number <- suppressWarnings(as.numeric(token))
    if (is.na(number)) stop("bad value")
    number
  }
  read_array <- function() {
    pos <<- pos + 1L
    out <- list()
    skip()
    if (pos <= n && cp[pos] == 93L) { pos <<- pos + 1L; return(out) }
    repeat {
      out[length(out) + 1L] <- list(read_value())
      skip()
      if (pos > n) stop("unterminated array")
      if (cp[pos] == 44L) { pos <<- pos + 1L; next }
      if (cp[pos] == 93L) { pos <<- pos + 1L; break }
      stop("bad array")
    }
    out
  }
  read_object <- function() {
    pos <<- pos + 1L
    out <- list()
    skip()
    if (pos <= n && cp[pos] == 125L) { pos <<- pos + 1L; return(out) }
    repeat {
      skip()
      if (pos > n || cp[pos] != 34L) stop("bad key")
      key <- read_string()
      skip()
      if (pos > n || cp[pos] != 58L) stop("bad object")
      pos <<- pos + 1L
      out[key] <- list(read_value())
      skip()
      if (pos > n) stop("unterminated object")
      if (cp[pos] == 44L) { pos <<- pos + 1L; next }
      if (cp[pos] == 125L) { pos <<- pos + 1L; break }
      stop("bad object")
    }
    out
  }
  read_value()
}

# Every non-ASCII character is written as \uXXXX, so the line is the same in any locale.
json_string <- function(text) {
  cp <- utf8ToInt(enc2utf8(paste(text, collapse = "\n")))
  out <- character(length(cp))
  for (i in seq_along(cp)) {
    ch <- cp[i]
    out[i] <- if (ch == 34L) "\\\"" else if (ch == 92L) "\\\\" else if (ch == 10L) "\\n" else if (ch == 13L) "\\r" else if (ch == 9L) "\\t" else if (ch < 32L || (ch > 126L && ch < 65536L)) sprintf("\\u%04x", ch) else if (ch >= 65536L) {
      v <- ch - 65536L
      sprintf("\\u%04x\\u%04x", 55296L + v %/% 1024L, 56320L + v %% 1024L)
    } else intToUtf8(ch)
  }
  paste0("\"", paste(out, collapse = ""), "\"")
}

# The printed text ends its line first so the sentinel always starts one.
emit <- function(id_token, payload, printed) {
  if (length(printed) > 0L && any(nzchar(printed))) {
    cat(paste0(paste(printed, collapse = "\n"), "\n"))
  }
  fields <- vapply(names(payload), function(key) paste0(json_string(key), ":", json_string(payload[[key]])), character(1))
  cat(SENTINEL, "{\"id\":", id_token, if (length(fields) > 0L) "," else "", paste(fields, collapse = ","), "}\n", sep = "")
  flush(stdout())
}

# Evaluates the code in the global environment; the value of the last expression is printed when it is visible.
run_cell <- function(code) {
  warnings_seen <- character(0)
  value_text <- NULL
  failure <- NULL
  printed <- character(0)
  handle <- function(expr) {
    withCallingHandlers(
      tryCatch(expr, error = function(e) { failure <<- conditionMessage(e); NULL }),
      warning = function(w) {
        warnings_seen <<- c(warnings_seen, paste0("Warning: ", conditionMessage(w)))
        invokeRestart("muffleWarning")
      }
    )
  }
  printed <- capture.output({
    handle({
      exprs <- parse(text = code, keep.source = FALSE)
      last <- NULL
      for (expr in exprs) last <- withVisible(eval(expr, envir = .GlobalEnv))
      if (!is.null(last) && last$visible) value_text <- capture.output(print(last$value))
    })
  })
  if (!is.null(failure)) return(list(payload = list(error = failure), printed = printed))
  text <- c(value_text, warnings_seen)
  list(payload = if (length(text) > 0L) list(text = paste(text, collapse = "\n")) else list(), printed = printed)
}

# A param name must be a plain identifier and must not be one of the driver's own names.
invalid_param_name <- function(params) {
  for (name in names(params)) {
    if (!grepl("^[A-Za-z][A-Za-z0-9_]*$", name, perl = TRUE) || name %in% ls(driver, all.names = TRUE)) return(name)
  }
  NULL
}

main <- function() {
  con <- file("stdin", open = "r")
  repeat {
    line <- readLines(con, n = 1L, warn = FALSE, encoding = "UTF-8")
    if (length(line) == 0L) break
    if (!nzchar(trimws(line))) next
    request <- tryCatch(parse_json_line(line), error = function(e) NULL)
    if (!is.list(request) || is.null(request$id) || !is.numeric(request$id) || !is.character(request$code)) next
    id_token <- format(request$id, scientific = FALSE)
    params <- if (is.list(request$params)) request$params else list()
    rejected <- invalid_param_name(params)
    if (!is.null(rejected)) {
      emit(id_token, list(error = paste("Invalid parameter name", rejected)), character(0))
      next
    }
    # Values come from the parsed JSON and are assigned as data, never evaluated.
    for (name in names(params)) assign(name, params[[name]], envir = .GlobalEnv)
    outcome <- run_cell(request$code)
    emit(id_token, outcome$payload, outcome$printed)
  }
}

main()
})
