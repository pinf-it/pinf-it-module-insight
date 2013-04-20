*STATUS: DEV*

Code Module Wrapper
===================

Code module standards are evolving but there are various differences across communities.

This library attempts to wrap code modules to a common format for
any code that adheres to the following conventions:

  * [CommonJS](http://wiki.commonjs.org/wiki/Modules/1.1)
  * [nodejs](http://nodejs.org/api/modules.html)
  * [AMD](https://github.com/amdjs/amdjs-api/wiki/AMD)
  * [UMD](https://github.com/umdjs/umd)
  * And various other formats. See `./test/assets/various`.


Install
-------

    npm install pinf-it-codewrap


Usage
-----

    const CODEWRAP = require("codewrap");
  
    CODEWRAP.parseFile("<path>", {}, function(err, descriptor) {
      // `descriptor.globals`
      // `globals`
      // `format`
      // `undefine`
      // `warnings`
      // `errors`
    });


Development
-----------

    make test


Links
=====

  * http://addyosmani.com/writing-modular-js/
  * https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API


License
=======

[UNLICENSE](http://unlicense.org/)
