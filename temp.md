## 介绍

express框架大家都已经都很熟悉，是NodeJS最流行的轻量web开发框架。他简单易用，却功能强大。最近一个月来一直反复研究调试express框架，深究其源码不觉为之惊叹，不论是原理与代码都非常简单，很容易理解也很受用，觉得有必要写个文章分享一下。本系列分2部分全面介绍express。上篇讲express框架主要原理和重要的组成部分，下篇是利用这些原理从零开发一个express框架（覆盖主要功能）；一篇理论一篇实战演练配合完全深入掌握express原理。

由于一些原因本文基于express 3.x版本，但与express4.x差别不大；（express4.x自己实现了connect组件，增加了proxy等）。

## 适合读者

- 有较扎实的JavaScript的基础
- 了解NodeJS的http、fs、path等模块
- 了解express

## [express](http://www.expressjs.com.cn/)框架提供的能力

可以在express的官网中看到express具备中间件的使用、路由、模板引擎、静态文件服务、设置代理等主要能力。后面将逐一讲解其实现。

## 本文将主要涵盖以下内容

- NodeJS的http模块创建的服务
- express中间件思想的本质 - 异步串行化流程控制
- express的router实现原理
- 模板引擎
- 静态文件服务

读者阅读本文可以配合[这份稍微做了简化版的express](https://github.com/linweiwei123/express-mini)进行运行与调试，方便理解；

## express构造的是Http.createServer的回调函数

express是一个基于NodeJS的框架，先来看下如果不使用框架要创建一个最简单的web应用应该是怎么样

    const http = require('http');
    const server = http.createServer(function(req, res){
        res.end('hello word!')
    });
    server.listen(8000);
    

实际上express是一个函数，运行后可以构造出上面代码中http.createServer的回调函数，express做的一切文章都是在这个回调函数上。来看下express3.x的源码express.js

    //========== 你的应用 app.js ==================
    const http = require('http')
    const app = express()
    
    app.get('/', (req, res) => res.send('Hello World!'))
    
    const server = http.createServer(app)
    server.listen(8000);
    
    //========== express.js =============
    var connect = require('connect')
    
    function createApplication() {
      var app = connect();
      utils.merge(app, proto);
      app.request = { __proto__: req };
      app.response = { __proto__: res };
      app.init();
      return app;
    }
    
    module.exports = createApplication;
    
    //=========== express依赖的connect.js==============
    function createServer() {
      function app(req, res, next){ app.handle(req, res, next); }
      // ... 省略
      return app;
    }
    
    module.exports = createServer;
    

connect.js的具体内容先不关心，后面会重点介绍。可以看出connect是一个函数，运行返回一个app，app是一个形如function(req, res , next){ ... } 的函数。express的createApplication返回即是此app，用于http.createServer的回调。并在这个函数上混入的许多能力，如req、res的处理、模板引擎、静态文件服务、router的能力。

![](https://pic2.zhimg.com/80/v2-df324fff2a6e6ae252bc89b40aa13b1d_hd.jpg)

用比较简单的伪代码表示如下

    const app = express();
    
    // nodejs启动时，app函数内部被express增加了能力，如中间件的调用 
    app.use(middleware)； // 中间件 
    app.use(router)； // 路由 
    app.engine('ejs'); // 模板引擎 
    app.statifc('public') // 静态文件服务 
    // ... 还有代理以及其他许多属性与方法
    
    const server = http.createServer(
          function app(req, res){  // 此app函数即为express所构造
               // http请求时，req， res被混入许多属性与方法，做了很多处理
               // 串行匹配运行按顺序注册的各注册的中间件如：
               // 1、日志、cookie、bodyparser等开发者自己注册的中间件
               // 2、router中间件
               // 3、静态文件服务
               // 4、模板引擎处理
               // 经过匹配的中间件处理后输出返回
          }
    );
    
    server.listen(8000);
    

上面的1、2、3、4顺序即为开发者注册时的顺序（故我们平时在开发时express注册中间件时是有先后顺序的）。express最主管理与运行中间件的能力，接下来深入内部看看connect这个中间件机制是怎么实现的。

## 最为核心的中间件框架

    //connect.js 的简要内容
    
    function createServer(){
        
        // app是用于http.createServer的回调函数
        function app(req, res, next){
        
            // 运行时调用handle函数
            app.handle(req, res, next);
        }
    
        mixin(app, proto, false);
        
        // 初始化一个stack数组
        app.stack = []; 
        return app;
    }
    
    // use调用时往app的stack数组中push一个对象（中间件），标识path与回调函数
    proto.use = function(route, fn){
        var path = route, 
        handle = fn;
    
        //...  省略其他
        
        this.stack.push({
            route: path,
            handle
        });
    };
    
    // handle方法，串行取出stack数组中的中间件，逐个运行
    proto.handle = function(req, res, out){
        var index = 0;
        var stack = this.stack;
        var done = out || finalhandler(req, res, { onerror: logerror });
    
        // 遍历stack，逐个取出中间件运行
        function next(err){
            var layer = stack[index++];
            // 遍历完成为止
            if(layer === undefined){
                return done();
            }
    
            var route = pathFormat(layer.route);
            var pathname = pathFormat(urlParser(req.url).pathname || '/');
    
            // 匹配中间件，不匹配的不运行
            if(route !== '' && pathname !== route){
                next(err);
                return;
            }
    
            // 调用中间件
            call(layer.handle, err, req, res, next);
        }
    
        next();
    };
    

不难看出，app.use中间件时，只是把它放入一个数组中。当http请求时，app会从数组中逐个取出，进行匹配过滤，逐个运行。遍历完成后，运行finalhandler，结束一个http请求。可以从http请求的角度思考，一次请求它经历经历了多少东西。express的这个中间件架构就是负责管理与调用这些注册的中间件。中间件顺序执行，通过next来继续下一个，一旦没有继续next，则流程结束。

接下来提一下异步编程的串行控制，加强理解；

## 异步串行流程控制

为了用串行化流程控制让几个异步任务按顺序执行，需要先把这些任务按预期的执行顺序放 到一个数组中。如图，所示，这个数组将起到队列的作用:完成一个任务后按顺序从数组中取 出下一个

![](https://pic4.zhimg.com/80/v2-5b5b41971e5c894405df35e55d2fe39f_hd.jpg)

数组中的每个任务都是一个函数。任务完成后应该调用一个处理器函数，告诉它错误状态和 结果。如果有错误，处理器函数会终止执行;如果没有错误，处理器就从队列中取出下一个任务 执行它

下面是一个简单实现方案：

    // 数组
    var tasks = [
        function A(){
            //...
            next();
        },
        function B(){
            //...
            next()
        },
        function C(){
            //...
            next()
        }
        //...
    ];
    
    function next(err, result){
        if(err) throw err;
        var currentTask = tasks.shift();
        if(currentTask) currentTask(result)
        next();
    }
    
    // 首次主动调用
    next();
    

异步串行控制方案除了上面的这种以外，还可以用es6的promise的then链、async/await、yeild、社区工具等；

可以看到代码确实谈不上高级😂，串行导致的性能谈不上优秀，但是得益于此它足够简单易用。到此可以发现express的中间件架构就是一个中间件的的管理与数组遍历运行，这个方案就让社区形形色色各种各样的中间件很好的添加express能力，这点很简单也很重要，因为后续的路由、静态文件服务、代理等都是中间件，都在这个框架内运行。

## Router是一个内置在app函数上的中间件

来看下简化后的router.js

    //express创建时运行
    app.init = function(){
        // ... 省略其它代码
        this._router = new Router();
        this.usedRouter = false;
        
        // app调用router时初始化router中间件
        Object.defineProperty(this, 'router', {
            configurable : true,
            enumerable : true,
            get: function () {
                this.usedRouter = true;
                return this._router.middlewareInit.bind(this._router);
            }
        })
    };
    
    // methods是一个数组，['get','post','put','delete',...]
    methods.forEach(method => {
        app[method] = function (path) {
            // 如果首次调用则放入路由中间价
            if(!this.usedRouter){
                this.use(this.router);
            }
    
            // 加入stack
            this._router.addRoute(method, path, Array.prototype.slice.call(arguments, 1))
        }
    });
    

上面的usedRouter是个开关，未开启则不加入router中间件，因为应用理论上也是可能不用到router的。当app[method] 如app.get('/user', fn)调用后，则触发this.use(this.router) 使用router中间件，同时把usedRouter设置为true。之后往router对象中加入fn回调函数。

router实际上也是一个异步串行流程控制，简化版的代码如下

    Router.prototype.addRoute = function(method, path, handles){
        let layer = {
          path,
          handles
        };
        this.map[method] = this.map[method] || [];
        this.map[method].push(layer);
    };
    
    Router.prototype.middlewareInit = function(req, res, out){
    
        let index = 0;
        let method = req.method.toLowerCase() || 'get';
        let stack = this.map[method];
    
        function next(err) {
            let layer = stack[index++];
            let hasError = Boolean(err);
    
            // 如果没有了则结束中间件，走下一个中间件
            if(!layer){
                return hasError ? out(err) : out();
            }
    
            let route = utils.pathFormat(layer.path);
            let pathname = utils.pathFormat(urlParser(req.url).pathname || '/');
    
            // 进行过滤
            if(route!== '' && route !== pathname){
                return next(err);
            }
    
            executeHandles(layer.handles, err, req, res, next);
        }
    
        next();
    };
    

router跟connect非常类似，上述理解了connect，router就很清晰了。一图以蔽之：

![](https://pic3.zhimg.com/80/v2-038ac07a7c23b2184a1a2f552cfbf8d6_hd.jpg)

实际上router还有细分，某个router还是可以继续做类似的串行流程控制；与中间件相同，每个router一旦停止了next，流程就结束了。

request经过router可以请求一个数据，或者一个网页；网页的话是怎么返回的呢，接下来看下view的render；

## 视图-模板引擎

模板引擎是根据对模板结合data进行运行处理，生产real html；这跟React、Vue、模板引擎是类似的。模板引擎不是express 实现的，实际上express仅仅只是做了调用；这里有个通用的支持各种模板引擎的模块[consolidate.js](https://github.com/tj/consolidate.js)

    var cons = require('consolidate')
      , name = 'swig';
    
    cons[name]('views/page.html', { user: 'tobi' }, function(err, html){
      if (err) throw err;
      console.log(html);
    });
    

express要做的只是配置与调用；

    // express设置属性
    app.set = function(key, value){
        if(this.settings.hasOwnProperty(key)){
            return this.settings[key];
        }
        this.settings[key] = value;
    };
    
    app.engine = function(engine){
        this.settings['engine'] = engine;
    };
    

通过这两个函数设置views视图所在的路径、模板引擎类型，之后express就可以结合router提供的render page，data，render callback的数据进行视图渲染

    app.render = function (name, options, fn) {
    
        let cacheTemplate = this.cache[name];
    
        let view = cacheTemplate || new View(name, {
            root: process.cwd(),
            viewPath: this.settings['views'],
            engine: this.settings['engine']
        });
    
        if(!cacheTemplate && this.settings['view cache']){
            this.cache[name] = view;
        }
    
        view.render(options, fn);
    };
    // View.js 简化
    
    function View(page, config){
        console.log('view 初始化');
        this.engine = config.engine || 'ejs';
        this.templatePath = path.join(config.root, config.viewPath, page);
        this.lookup();
    }
    
    //检测模板是否存在
    View.prototype.lookup = function(){
        if(!fs.existsSync(this.templatePath)){
            console.log('模板没有找到');
            throw new Error('模板没有找到');
        }
    };
    
    View.prototype.render = function (options, fn) {
        let templatePath= this.templatePath;
        // 调用模板引擎完成渲染
        return cons[this.engine](templatePath, options, fn);
    };
    

为了性能考虑还做了cache；关于模板引擎，实际上很简单，读者可以自定一个模板引擎规则。

## 静态文件服务

静态文件服务也是一个中间件，express做的事情也仅仅是引用。require一个serve-static，内置在app函数上。

    app.static = function (dir) {
        this.use(serveStatic(process.cwd() + '/' + dir), {});
    };
    

当调用app.static时就会把静态文件服务中间件放入stack中，这里与express调用方式稍有不同，因为笔者觉得这么写更好更简单。

## 更多的内容

express除了上述的内容外，还做了req，res的扩展。还有许多细节未展开描述。但最核心的内容已经在上面呈现。读者可以在express的基础上扩展更多内容加强框架。只需明白一点，express核心主要是一个中间件串行控制方案，内置来router、静态文件服务中间件、扩展了req，res，其他功能都是集成了其他模块来加强的；确实是一个简单易用的web框架。

## 总结

express我自己实现了一遍，读者可以自行阅读express源码，也可以查看我的express-mini；后续我会对koa、egg等其他框架做一次深入的研究，也会对新的deno做一个类似的封装实现。有兴趣的可以继续关注我的博文
