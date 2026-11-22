// @nestjs/common's StreamableFile references stream.Readable; the API never streams files that way.
const { EventEmitter } = require('events');
class Stream extends EventEmitter {}
class Readable extends Stream {}
class Writable extends Stream {}
class Transform extends Stream {}
class PassThrough extends Transform {}
module.exports = { Stream, Readable, Writable, Transform, PassThrough };
