# Persistent cell driver: reads one JSON request per stdin line and keeps one session (the global environment) for the life of the process.
# Each response is a line "\u0001LABSHELF\u0001" + JSON {id, text|error, plot?, warnings?}; anything the cell prints goes to stdout before it.
# Graphics: each cell runs with a png() device open; when the cell draws on it, text is the PNG as a data URL, and a ggplot
# last value made only of line, path and point layers also returns plot, the labshelf-plot spec JSON as a string.
# Run as: Rscript --vanilla cellDriver.R. Base R only: no package is loaded, so the driver needs no installed library
# (ggplot2 is only touched, through requireNamespace, when the last value already is a ggplot).

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
# Printable ASCII with tabs and line breaks is escaped with gsub; the per-code-point loop only runs for other characters.
json_string <- function(text) {
  text <- enc2utf8(paste(text, collapse = "\n"))
  if (!grepl("[^\\x20-\\x7e\\t\\n\\r]", text, perl = TRUE, useBytes = TRUE)) {
    out <- gsub("\\", "\\\\", text, fixed = TRUE, useBytes = TRUE)
    out <- gsub("\"", "\\\"", out, fixed = TRUE, useBytes = TRUE)
    out <- gsub("\n", "\\n", out, fixed = TRUE, useBytes = TRUE)
    out <- gsub("\r", "\\r", out, fixed = TRUE, useBytes = TRUE)
    out <- gsub("\t", "\\t", out, fixed = TRUE, useBytes = TRUE)
    return(paste0("\"", out, "\""))
  }
  cp <- utf8ToInt(text)
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

# Raw JSON: a value of class "labshelf_json" is written as is by emit and by json_object.
json_raw <- function(text) structure(text, class = "labshelf_json")

json_value <- function(value) if (inherits(value, "labshelf_json")) unclass(value) else json_string(value)

# A named list of values (raw JSON or character) as a JSON object.
json_object <- function(fields) {
  parts <- vapply(names(fields), function(key) paste0(json_string(key), ":", json_value(fields[[key]])), character(1))
  json_raw(paste0("{", paste(parts, collapse = ","), "}"))
}

json_array <- function(values) json_raw(paste0("[", paste(vapply(values, json_value, character(1)), collapse = ","), "]"))

# Numbers to 4 significant digits; NA, NaN and infinite values are null, and -0 is 0.
json_numbers <- function(x) {
  x <- signif(as.numeric(x), 4)
  finite <- is.finite(x)
  x[finite & x == 0] <- 0
  out <- rep("null", length(x))
  out[finite] <- formatC(x[finite], digits = 4, format = "g")
  json_raw(paste0("[", paste(trimws(out), collapse = ","), "]"))
}

# The printed text ends its line first so the sentinel always starts one.
emit <- function(id_token, payload, printed) {
  if (length(printed) > 0L && any(nzchar(printed))) {
    cat(paste0(paste(printed, collapse = "\n"), "\n"))
  }
  fields <- vapply(names(payload), function(key) paste0(json_string(key), ":", json_value(payload[[key]])), character(1))
  cat(SENTINEL, "{\"id\":", id_token, if (length(fields) > 0L) "," else "", paste(fields, collapse = ","), "}\n", sep = "")
  flush(stdout())
}

BASE64 <- strsplit("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", "")[[1]]

# Vectorised base64 of a raw vector.
base64 <- function(bytes) {
  n <- length(bytes)
  if (n == 0L) return("")
  pad <- (3L - n %% 3L) %% 3L
  b <- matrix(c(as.integer(bytes), integer(pad)), nrow = 3L)
  b1 <- b[1L, ]; b2 <- b[2L, ]; b3 <- b[3L, ]
  idx <- rbind(
    bitwShiftR(b1, 2L),
    bitwOr(bitwShiftL(bitwAnd(b1, 3L), 4L), bitwShiftR(b2, 4L)),
    bitwOr(bitwShiftL(bitwAnd(b2, 15L), 2L), bitwShiftR(b3, 6L)),
    bitwAnd(b3, 63L)
  )
  chars <- BASE64[as.vector(idx) + 1L]
  if (pad > 0L) chars[(length(chars) - pad + 1L):length(chars)] <- "="
  paste(chars, collapse = "")
}

png_data_url <- function(file) {
  bytes <- readBin(file, "raw", file.info(file)$size)
  paste0("data:image/png;base64,", base64(bytes))
}

# The labshelf-plot spec JSON for a ggplot made only of line, path and point layers on one panel with continuous
# identity or log10 axes and one colour per group; NULL otherwise or on any error.
ggplot_spec <- function(value) {
  if (!inherits(value, "ggplot") || !requireNamespace("ggplot2", quietly = TRUE)) return(NULL)
  tryCatch(build_ggplot_spec(value), error = function(e) NULL)
}

build_ggplot_spec <- function(value) {
  b <- ggplot2::ggplot_build(value)
  layers <- b$plot$layers
  if (length(layers) == 0L || length(layers) != length(b$data)) return(NULL)
  axis_log <- function(scales) {
    if (length(scales) != 1L) return(NA)
    scale <- scales[[1L]]
    if (!inherits(scale, "ScaleContinuous")) return(NA)
    trans <- if (is.function(scale$get_transformation)) scale$get_transformation() else scale$trans
    name <- trans$name
    if (identical(name, "identity")) return(FALSE)
    if (name %in% c("log-10", "log10")) return(TRUE)
    NA
  }
  log_x <- axis_log(b$layout$panel_scales_x)
  log_y <- axis_log(b$layout$panel_scales_y)
  if (is.na(log_x) || is.na(log_y)) return(NULL)
  traces <- list()
  for (i in seq_along(layers)) {
    geom <- layers[[i]]$geom
    type <- if (inherits(geom, "GeomLine")) "line" else if (inherits(geom, "GeomPath")) "path" else if (inherits(geom, "GeomPoint")) "points" else return(NULL)
    data <- b$data[[i]]
    if (nrow(data) == 0L) next
    if (nlevels(as.factor(data$PANEL)) != 1L) return(NULL)
    x <- if (log_x) 10^data$x else data$x
    y <- if (log_y) 10^data$y else data$y
    group <- if (is.null(data$group)) rep(-1L, nrow(data)) else data$group
    for (g in sort(unique(group))) {
      rows <- which(group == g)
      colours <- unique(data$colour[rows])
      if (length(colours) > 1L) return(NULL)
      if (type == "line") rows <- rows[order(x[rows])]
      trace <- list(type = if (type == "points") "points" else "line")
      if (length(colours) == 1L && !is.na(colours)) {
        rgb <- grDevices::col2rgb(colours)
        trace$color <- sprintf("#%02x%02x%02x", rgb[1L], rgb[2L], rgb[3L])
      }
      trace$x <- json_numbers(x[rows])
      trace$y <- json_numbers(y[rows])
      traces[[length(traces) + 1L]] <- json_object(trace)
    }
  }
  if (length(traces) == 0L) return(NULL)
  labels <- if (exists("get_labs", envir = asNamespace("ggplot2"), inherits = FALSE)) getExportedValue("ggplot2", "get_labs")(value) else value$labels
  label <- function(key) {
    text <- labels[[key]]
    if (is.character(text) && length(text) == 1L && !is.na(text) && nzchar(text)) text else NULL
  }
  axis <- function(key, log) {
    fields <- list()
    if (!is.null(label(key))) fields$label <- label(key)
    if (log) fields$log <- json_raw("true")
    json_object(fields)
  }
  spec <- list(v = json_raw("1"), dim = json_raw("2"))
  if (!is.null(label("title"))) spec$title <- label("title")
  spec$axes <- json_object(list(x = axis("x", log_x), y = axis("y", log_y)))
  spec$traces <- json_array(traces)
  unclass(json_object(spec))
}

# The error message, with the install.packages command appended when the error is a missing package.
error_message <- function(e) {
  message <- conditionMessage(e)
  pkg <- NULL
  if (inherits(e, "packageNotFoundError") && is.character(e$package) && length(e$package) == 1L) {
    pkg <- e$package
  } else {
    found <- regmatches(message, regexec("there is no package called [‘'\"]([^’'\"]+)[’'\"]", message))[[1]]
    if (length(found) == 2L) pkg <- found[2L]
  }
  if (is.null(pkg)) message else paste0(message, "\nInstall it with: install.packages(\"", pkg, "\")")
}

# Evaluates the code in the global environment; the value of the last expression is printed when it is visible.
# A png device is open during the evaluation; when the cell drew on it, the PNG replaces the value text.
# Warnings ("Warning: <message>", one per entry) go beside the payload on every path, never into the text.
run_cell <- function(code, preview = FALSE) {
  warnings_seen <- character(0)
  value_text <- NULL
  failure <- NULL
  printed <- character(0)
  plot <- NULL
  handle <- function(expr) {
    withCallingHandlers(
      tryCatch(expr, error = function(e) { failure <<- error_message(e); NULL }),
      warning = function(w) {
        warnings_seen <<- c(warnings_seen, paste0("Warning: ", conditionMessage(w)))
        invokeRestart("muffleWarning")
      }
    )
  }
  prefix <- tempfile("labshelf-plot-")
  grDevices::png(paste0(prefix, "%03d.png"), width = 6.4, height = 4.8, units = "in", res = 160, bg = "transparent")
  grDevices::dev.control("enable")
  device <- grDevices::dev.cur()
  printed <- capture.output({
    handle({
      exprs <- parse(text = code, keep.source = FALSE)
      last <- NULL
      for (expr in exprs) last <- withVisible(eval(expr, envir = .GlobalEnv))
      if (!is.null(last) && last$visible) {
        plot <- ggplot_spec(last$value)
        # A preview with a spec answers the spec only: the ggplot is not printed to the device.
        if (!(preview && !is.null(plot))) value_text <- capture.output(print(last$value))
      }
    })
  })
  open <- device %in% grDevices::dev.list()
  if (open) grDevices::dev.off(device)
  pages <- sort(Sys.glob(paste0(prefix, "*.png")))
  spec_only <- preview && !is.null(plot) && is.null(failure)
  image <- if (!spec_only && open && is.null(failure) && length(pages) > 0L) tryCatch(png_data_url(pages[length(pages)]), error = function(e) NULL) else NULL
  unlink(pages)
  answer <- function(payload) {
    if (length(warnings_seen) > 0L) payload$warnings <- json_array(warnings_seen)
    list(payload = payload, printed = printed)
  }
  if (!is.null(failure)) return(answer(list(error = failure)))
  if (spec_only) return(answer(list(plot = plot)))
  if (!is.null(image)) return(answer(if (is.null(plot)) list(text = image) else list(text = image, plot = plot)))
  answer(if (length(value_text) > 0L) list(text = paste(value_text, collapse = "\n")) else list())
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
    preview <- isTRUE(request$preview)
    rejected <- invalid_param_name(params)
    if (!is.null(rejected)) {
      emit(id_token, list(error = paste("Invalid parameter name", rejected)), character(0))
      next
    }
    # Values come from the parsed JSON and are assigned as data, never evaluated.
    for (name in names(params)) assign(name, params[[name]], envir = .GlobalEnv)
    outcome <- run_cell(request$code, preview)
    emit(id_token, outcome$payload, outcome$printed)
  }
}

main()
})
