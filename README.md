*STATUS: DEV*

Module Insight
==============

Module standards are evolving but there are various differences across communities.

This library attempts to generate a normalized module descriptor for
any module that adheres to any the following conventions:

  * [CommonJS](http://wiki.commonjs.org/wiki/Modules/1.1)
  * [nodejs](http://nodejs.org/api/modules.html)
  * [AMD](https://github.com/amdjs/amdjs-api/wiki/AMD)
  * [UMD](https://github.com/umdjs/umd)
  * And various other formats. See `./test/assets/various`.


Install
-------

    npm install pinf-it-module-insight


Usage
-----

    const MODULE_INSIGHT = require("pinf-it-module-insight");
    
    MODULE_INSIGHT.parseFile("<path>", {}, function(err, descriptor) {
        // `descriptor.globals`
        // `descriptor.format`
        // `descriptor.undefine`
        // `descriptor.warnings`
        // `descriptor.errors`
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
