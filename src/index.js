import bunyan from 'bunyan'
import useragent from 'useragent'
import uuid from 'uuid'
import omit from 'omit-deep'

const logLevel = (status, err) => {
  if (err || status >= 500) {
    return 'error'
  } else if (status >= 400) {
    return 'warn'
  }

  return 'info'
}

const generateRequestId = (req) => {
  const requestId = uuid.v4()
  req.id = requestId // eslint-disable-line
  return requestId
}

const createLogger = () => (err, req, res, next) => {
  const startTime = process.hrtime()
  const requestId = generateRequestId(req)

  const logger = bunyan.createLogger({
    name: 'express',
  })
  const childLogger = requestId !== undefined ? logger.child({ req_id: requestId }) : logger

  const logging = (incoming, resbody) => {
    const status = res.statusCode
    const method = req.method
    const url = (req.baseUrl || '') + (req.url || '-')
    const referer = req.header('referer') || req.header('referrer') || '-'
    const ua = useragent.parse(req.header('user-agent')) || req.header('user-agent')
    const httpVersion = `${req.httpVersionMajor}.${req.httpVersionMinor}`
    const hrtime = process.hrtime(startTime)
    const responseTime = (hrtime[0] * 1e3) + (hrtime[1] / 1e6)
    const ip = req.ip || req.connection.remoteAddress ||
              (req.socket && req.socket.remoteAddress) ||
              (req.socket.socket && req.socket.socket.remoteAddress) ||
              '127.0.0.1'

    const body = req.body
    if (body.variables) {
      try {
        body.variables = JSON.parse(body.variables)
      } catch (e) {
        delete body.variables
      }
    }

    const meta = {
      'remote-address': ip,
      ip,
      method,
      url,
      referer,
      'user-agent': ua,
      body,
      'http-version': httpVersion,
      'response-time': responseTime,
      'response-hrtime': hrtime,
      'status-code': status,
      'req-headers': req.headers,
      'res-headers': res._headers, // eslint-disable-line
      'res-body': resbody,
    }
    if (err) {
      meta.err = err
    }

    const level = logLevel(status, err, meta)
    const logFn = childLogger[level] ? childLogger[level] : childLogger.info

    const metaWithoutSensitiveProperties = omit(meta, ['cvv', 'password'])
    logFn.call(childLogger, metaWithoutSensitiveProperties)
  }

  const resWrite = res.write
  const resEnd = res.end
  const chunks = []

  res.write = function (chunk) { // eslint-disable-line
    chunks.push(new Buffer(chunk))

    resWrite.apply(res, arguments)
  }

  res.end = function (chunk) { // eslint-disable-line
    if (chunk) {
      chunks.push(new Buffer(chunk))
    }
    const body = Buffer.concat(chunks).toString('utf8')
    logging(false, body)

    resEnd.apply(res, arguments)
  }

  next(err)
}

export default () => {
  const logger = createLogger()

  return (req, res, next) => {
    logger(null, req, res, next)
  }
}
