import React from "react";

const AboutContentAR = () => (
  <>

    {/* ═══ الأهداف ═══ */}
    <section id="about-objectives" className="about_section">
      <h2 className="about_section_title">الأهداف</h2>
      <ol className="about_objectives_list">
        <li>
          <span className="about_obj_label">استخراج الهيولات من اللغة السريرية</span>
          <span className="about_obj_desc">استخدام النصوص السريرية والعلمية بوصفها المادة المصدرية الأساسية — والوسيط الوحيد المتاح حاليًا — لتحديد الكيانات السريرية غير المتمايزة وتسميتها.</span>
        </li>
        <li>
          <span className="about_obj_label">تصنيف الهيولات ضمن فئات منظَّمة</span>
          <span className="about_obj_desc">تمييز الهيولات المستخرجة إلى: <strong>أشياء، آثار، ظواهر، مفاهيم، ونماذج</strong>، مع تنظيم كل فئة بحسب المقياس البيولوجي، من الجزيء إلى المريض بوصفه إنسانًا كاملًا.</span>
        </li>
        <li>
          <span className="about_obj_label">بناء معجم سريري سابق للمواجهة</span>
          <span className="about_obj_desc">إنشاء إطار منظَّم من الكيانات المسماة والمصنفة يمكنه توجيه وتنظيم المقابلة المباشرة مع المريض، بحيث يصل الطبيب إلى المريض مستعدًا، لا فارغ اليدين.</span>
        </li>
        <li>
          <span className="about_obj_label">تسجيل الظواهر الذاتية للمريض</span>
          <span className="about_obj_desc">في مقابلة المريض، تُلتقط الخبرات التي يعيشها هذا المريض تحديدًا عبر: العين، والأذن، واللسان، والجلد، والأنف؛ وتُربط الهيولات المستخرجة بالواقع المعيش والمتجسد، لا باللغة وحدها.</span>
        </li>
        <li>
          <span className="about_obj_label">الانتقال من المعرفة المتواسطة باللغة إلى المعرفة المتواسطة بالمواجهة</span>
          <span className="about_obj_desc">الانتقال من نظام يقرأ آثار الملاحظات إلى نظام يشارك — من خلال الطبيب — في الملاحظة المباشرة للآثار. ويبقى المريض في مركز كل قرار تصنيفي.</span>
        </li>
      </ol>
    </section>

    {/* ═══ ما هو AMCTOSHS؟ ═══ */}
    <section id="about-what" className="about_section">
      <h2 className="about_section_title">ما هو AMCTOSHS؟</h2>
      <p className="about_section_body">
        AMCTOSHS هو نظام منظَّم ومتمحور حول المريض لاستخراج الهيولات وتصنيفها. صُمم لتحديد الكيانات المرتبطة بالسريريات وتنظيمها عبر المقاييس المختلفة؛ ويشمل الكيانات غير البيولوجية، مثل أدوات التشخيص والأجهزة والإجراءات، والكيانات البيولوجية، من البنى دون الجزيئية إلى المريض كاملًا، مع إبقاء المريض في مركز كل قرار تصنيفي.
      </p>
    </section>

    {/* ═══ توضيح محوري ═══ */}
    <section id="about-pivotal" className="about_section about_section--pivotal">
      <h2 className="about_section_title">توضيح محوري</h2>
      <p className="about_section_body">
        في هذه المرحلة، تمثل اللغة المصدر الوحيد المتاح للهيولات. يستخرج AMCTOSHS الهيولات من النصوص السريرية والعلمية — ملفات PDF، والأدبيات، والتقارير — لا مباشرة من المرضى. لا تُعامل اللغة هنا بوصفها الواقع النهائي، بل بوصفها تقريبًا أوليًا ضروريًا: الوسيط الوحيد الذي يمكن من خلاله تحديد الكيانات السريرية وتنظيمها قبل إتاحة الوصول المباشر إلى المرضى.
      </p>
      <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
        هذا الاستخراج من اللغة <strong>خطوة تحضيرية</strong>. فالغاية الحقيقية لـ AMCTOSHS هي تجاوز النص، واللقاء بالمرضى الحقيقيين، وبناء وصف منظَّم للظواهر الذاتية انطلاقًا من خبرتهم المعيشة: ما يراه المريض، ويسمعه، ويشعر به، ويتذوقه، ويشمه فيما يتصل بحالته. والهيولات المستخرجة من اللغة تؤسس الأرضية المفهومية التي تجعل هذه المقابلة ذات معنى ومنظَّمة.
      </p>
      <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
        باختصار: تأتي اللغة أولًا لأنها ما نملكه. ويأتي المريض بعدها لأنه ما يهم.
      </p>
    </section>

    {/* ═══ نمطان للوصول ═══ */}
    <section id="about-modes" className="about_section">
      <h2 className="about_section_title">نمطان للوصول السريري</h2>
      <p className="about_section_body">
        تعطيك النصوص <strong>واقعًا سريريًا متوسَّطًا</strong>. ويعطيك المرضى <strong>واقعًا سريريًا متجسدًا ومتموضعًا في سياقه</strong>.
      </p>
      <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
        النص هو بالفعل تحويل للمريض: فقد اختار شخص ما حقائق، وسمّى موجودات، وفرض تصنيفات، وحذف حالات عدم اليقين، ونظّم الحالة في سردية. وهو يجعل المقارنة والذاكرة والتعليم والإحصاء والتجريد ممكنة. لكنه في الوقت نفسه يجمّد إنسانًا متحركًا داخل وثيقة.
      </p>
      <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
        المريض ليس تقرير حالة. إنه يظهر من خلال صوته، وسلوكه، وجسده، ومساره الزمني، وعلاقاته، وخوفه، وعدم اتساقه، وبيئته، واستجابته لحضورك. كثير من هذه العناصر حاسم سريريًا لكنه ضعيف التمثيل في النصوص: الهشاشة، والانفعال، وسلوك الألم، والرائحة، والمشية، والتردد، وديناميكيات الأسرة، وموثوقية القصة المرضية، وكيف يتغير المرض خلال ساعات لا خلال فقرات.
      </p>

      <table className="about_compare_table">
        <thead>
          <tr>
            <th>الوصول عبر النصوص</th>
            <th>الوصول عبر المرضى</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>غير مباشر ومفسَّر</td><td>مباشر لكنه يبقى مفسَّرًا</td></tr>
          <tr><td>ثابت، قابل للبحث والمقارنة</td><td>ديناميكي، مشروط، وفردي بصورة لا يمكن اختزالها</td></tr>
          <tr><td>مدفوع بالفئات</td><td>مدفوع بالظواهر</td></tr>
          <tr><td>استرجاعي أو مضغوط</td><td>آني وزمني</td></tr>
          <tr><td>يحفظ البيانات الصريحة</td><td>يكشف البيانات الضمنية والمتجسدة</td></tr>
          <tr><td>يعرّض للتجريد والحذف</td><td>يعرّض للتحيز والضجيج وفرط التأويل</td></tr>
        </tbody>
      </table>

      <p className="about_section_body" style={{ marginTop: "1rem" }}>
        لا يمثل أي منهما الواقع الخالص. فرؤية المريض هي أيضًا مشبعة بالنظرية: إذ إنك تلاحظ ما تسمح لك مفاهيمك بملاحظته. لكن النصوص تضيف طبقة أخرى من المسافة — فهي <strong>ملاحظات لملاحظات</strong>.
      </p>
      <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
        سريريًا، تكون النصوص أقوى في معرفة السكان، والاحتمال القبلي، والإرشادات، والسجلات الطولية، والتواصل القابل للتكرار. ويكون المرضى أقوى في تحديد ما إذا كانت الفئة التجريدية تنطبق بالفعل على هذا الإنسان بعينه الآن.
      </p>
      <p className="about_section_body about_section_body--warning" style={{ marginTop: "0.75rem" }}>
        الخطأ الجاد هو معاملة الملف الطبي بوصفه المريض. فالملف دليل عن المريض، وليس الواقع السريري للمريض نفسه.
      </p>
    </section>

    {/* ═══ أربعة مجالات ═══ */}
    <section id="about-reality" className="about_section">
      <h2 className="about_section_title">أربعة مجالات</h2>
      <p className="about_section_body">
        مصطلح «الواقع السريري» غير دقيق إذا استُخدم ليشمل كل شيء، لأن جسم المريض موجود استقلالًا عن أي طبيب يراقبه. والبنية الأدق تفصل بين ما يكونه المريض وبين ما يفعله الطب تجاهه. هناك أربعة مجالات متميزة:
      </p>

      <div className="about_reality_flow">
        <div className="about_reality_card about_reality_card--ontic">
          <div className="about_reality_card_label">واقع المريض</div>
          <div className="about_reality_card_sub">المجال الإنساني الأنطيقي — ما يكونه المريض</div>
          <ul className="about_reality_list">
            <li>الكائن الحي والجسم والأعضاء</li>
            <li>الفيزيولوجيا والمرضية</li>
            <li>العمليات المرضية</li>
            <li>الأعراض بوصفها خبرات معيشة</li>
            <li>البيئة والزمن والتغير</li>
          </ul>
        </div>

        <div className="about_reality_arrow">→</div>

        <div className="about_reality_card about_reality_card--epistemic">
          <div className="about_reality_card_label">الوصول السريري</div>
          <div className="about_reality_card_sub">المجال السريري الإبستيمي — كيف يعرف الطبيب</div>
          <ul className="about_reality_list">
            <li>الملاحظة والفحص والمقابلة</li>
            <li>القياس والتصوير والفحوص المخبرية</li>
            <li>التأويل والاستدلال</li>
            <li>التشخيص وعدم اليقين</li>
          </ul>
        </div>

        <div className="about_reality_arrow">→</div>

        <div className="about_reality_card about_reality_card--semantic">
          <div className="about_reality_card_label">التمثيل السريري</div>
          <div className="about_reality_card_sub">المجال السريري الدلالي — كيف تُشفَّر المعرفة</div>
          <ul className="about_reality_list">
            <li>الملاحظات والملفات والسرديات السريرية</li>
            <li>التسميات والرموز التشخيصية</li>
            <li>الصور والدرجات والنماذج</li>
          </ul>
        </div>

        <div className="about_reality_arrow">→</div>

        <div className="about_reality_card about_reality_card--praxis">
          <div className="about_reality_card_label">الفعل السريري</div>
          <div className="about_reality_card_sub">مجال الممارسة / المجال البراغماتي — كيف تُستخدم المعرفة</div>
          <ul className="about_reality_list">
            <li>العلاج والتدخل</li>
            <li>المراقبة والوقاية</li>
            <li>التواصل واتخاذ القرار</li>
          </ul>
        </div>
      </div>

      <p className="about_section_body about_section_body--warning" style={{ marginTop: "1.1rem" }}>
        المريض ليس «سريريًا». علاقة الطبيب بالمريض هي التي تكون سريرية.
      </p>
      <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
        ينتمي واقع المريض إلى المريض وحده؛ فهو موجود قبل أي لقاء سريري وأثناءه وبعده. أما الوصول السريري والتمثيل والفعل، فهي استجابات الطب لذلك الواقع. إن دمج هذه المجالات هو أصل كثير من أخطاء الاستدلال: كمعاملة الملف بوصفه المريض، أو معاملة التشخيص بوصفه المرض نفسه.
      </p>
    </section>

    {/* ═══ النفس ═══ */}
    <section id="about-psyche" className="about_section">
      <h2 className="about_section_title">النفس</h2>
      <div className="about_psyche_def">
        <div className="about_psyche_term">النفس</div>
        <div className="about_psyche_eq">=</div>
        <div className="about_psyche_body">
          المبدأ الحيوي الداخلي الذي يجعل الكيان<br />
          يتغير، وينمو، وينظّم ذاته،<br />
          ويحافظ على استمراريته عبر التحول.
        </div>
      </div>
    </section>

    {/* ═══ الإبستمولوجيا السريرية ═══ */}
    <section id="about-epistemology" className="about_section">
      <h2 className="about_section_title">الإبستمولوجيا السريرية</h2>
      <p className="about_section_body">
        قبل المعرفة، لا يوجد إلا الواقع وإمكان الوصول إليه. والسؤال عن الفعل الإبستيمي الأول يتوقف على أصل الكلمة المستخدمة لتسميته.
      </p>

      <div className="about_epist_etymology">
        <div className="about_epist_etym_word">التعرُّف</div>
        <div className="about_epist_etym_eq">= <span className="about_epist_etym_morph">re-</span> + <span className="about_epist_etym_morph">cogn-</span> + <span className="about_epist_etym_morph">-ition</span></div>
        <div className="about_epist_etym_rows">
          <div className="about_epist_etym_row">
            <span className="about_epist_etym_morph">re-</span>
            <span className="about_epist_etym_gloss">مرة أخرى / عودة</span>
          </div>
          <div className="about_epist_etym_row">
            <span className="about_epist_etym_morph">cogn-</span>
            <span className="about_epist_etym_gloss">معرفة — من اللاتينية <em>cognōscere</em>، أي «أن يأتي المرء إلى المعرفة»</span>
          </div>
          <div className="about_epist_etym_row">
            <span className="about_epist_etym_morph">-ition</span>
            <span className="about_epist_etym_gloss">فعل أو عملية</span>
          </div>
        </div>
        <div className="about_epist_etym_result">
          تأتي الكلمة من اللاتينية <em>recognōscere</em>: «أن يعرف مرة أخرى، يعترف، يفحص، يحدد». ومعناها الحرفي: <strong>معرفة الشيء بوصفه هذا الشيء القابل للتعيين.</strong>
        </div>
      </div>

      <p className="about_section_body" style={{ marginTop: "1rem" }}>
        يحمل هذا الاشتقاق تصحيحًا مهمًا. فـ <em>recognōscere</em> يفترض معرفة سابقة — أي إعادة لقاء نمط موجود بشكل ما في الذهن — ولذلك فإن التعرّف يفترض خطوات أسبق وأكثر بدائية: اللقاء، والانتباه، والتفريق يجب أن تسبقه.
      </p>

      <div className="about_epist_cols">

        <div className="about_epist_col">
          <div className="about_epist_col_title">التسلسل الإبستيمي المصحح</div>
          <ol className="about_epist_steps">
            {[
              { label: "الأنطوس",             sub: "الواقع موجود، استقلالًا عن أي عارف",                                        mark: null },
              { label: "الوصول",              sub: "يكون العارف في موضع يمكّنه من مواجهة أثر",                                 mark: null },
              { label: "اللقاء / الاستقبال",  sub: "يصل أثر إلى المراقب — وهو الحدث الإبستيمي الأكثر بدائية",                mark: "primitive" },
              { label: "الانتباه",             sub: "يسجل شيء ما حضوره؛ فينجذب الانتباه قبل أي تحديد",                       mark: "primitive" },
              { label: "التفريق",             sub: "يُفصل ذلك الشيء عن خلفيته",                                               mark: null },
              { label: "التعرُّف",            sub: "cognoscere → recognoscere: معرفة الشيء بوصفه هذا الشيء القابل للتعيين",   mark: "recognition" },
              { label: "التسمية",             sub: "يُربط بالشيء مقبض لغوي أو اسم",                                           mark: null },
              { label: "بناء العلاقات",        sub: "يُربط الكيان المسمّى بكيانات أخرى",                                       mark: null },
              { label: "التأويل",             sub: "يُمنح معنى في سياقه",                                                     mark: null },
              { label: "تكوين المفهوم",        sub: "تُبنى فئة ثابتة وقابلة للتكرار",                                         mark: null },
              { label: "التشخيص",             sub: "يُطبَّق المفهوم على الحالة الفردية",                                      mark: null },
            ].map((s, i) => (
              <li key={i} className={`about_epist_step${s.mark ? ` about_epist_step--${s.mark}` : ""}`}>
                <div className="about_epist_step_label">{s.label}</div>
                <div className="about_epist_step_sub">{s.sub}</div>
              </li>
            ))}
          </ol>
        </div>

        <div className="about_epist_col">
          <div className="about_epist_col_title">مثال سريري — تخطيط القلب الكهربائي</div>
          <ol className="about_epist_steps about_epist_steps--example">
            {[
              { label: "يوجد شكل موجي لتخطيط القلب",                    sub: "واقع أنطيقي",                      mark: null },
              { label: "يتموضع الطبيب أمام تخطيط القلب",                 sub: "يتحقق الوصول",                    mark: null },
              { label: "تصل إشارة إلى المراقب",                          sub: "اللقاء / الاستقبال",              mark: "primitive" },
              { label: "يُلاحَظ شيء ما",                                  sub: "الانتباه، قبل أي تحديد",          mark: "primitive" },
              { label: "يُفصَل مقطع ST عن خط الأساس",                    sub: "التفريق",                         mark: null },
              { label: "يُتعرَّف عليه بوصفه هذه الإشارة النمطية",         sub: "cognoscere → recognoscere",  mark: "recognition" },
              { label: "يُسمَّى «ارتفاع مقطع ST»",             sub: "التسمية",                         mark: null },
              { label: "يُربَط بالأعراض والتروبونين والتشريح",            sub: "بناء العلاقات",                   mark: null },
              { label: "يُفسَّر بوصفه إقفارًا محتملًا",                  sub: "التأويل",                         mark: null },
              { label: "يُبنى مفهوم احتشاء عضلة القلب أو يُرفَض",        sub: "تكوين المفهوم",                   mark: null },
              { label: "يُطبَّق التشخيص على هذا المريض الآن",             sub: "التشخيص",                         mark: null },
            ].map((s, i) => (
              <li key={i} className={`about_epist_step${s.mark ? ` about_epist_step--${s.mark}` : ""}`}>
                <div className="about_epist_step_label">{s.label}</div>
                <div className="about_epist_step_sub">{s.sub}</div>
              </li>
            ))}
          </ol>
        </div>

      </div>

      <div className="about_epist_distinctions" style={{ marginTop: "1.4rem" }}>
        <div className="about_epist_distinction">
          <span className="about_epist_term">الإدراك</span>
          <span className="about_epist_eq">=</span>
          <span className="about_epist_def">استقبال أثر</span>
        </div>
        <div className="about_epist_distinction about_epist_distinction--highlighted">
          <span className="about_epist_term">التعرُّف</span>
          <span className="about_epist_eq">=</span>
          <span className="about_epist_def">معرفة الأثر بوصفه هذا الشيء القابل للتعيين — <em>recognōscere</em></span>
        </div>
        <div className="about_epist_distinction">
          <span className="about_epist_term">المعرفة</span>
          <span className="about_epist_eq">=</span>
          <span className="about_epist_def">تحديد ماهيته وكيف يرتبط بغيره</span>
        </div>
      </div>

      <p className="about_section_body about_section_body--callout" style={{ marginTop: "1.1rem" }}>
        لا يمنح التعرُّف الحقيقة بعد. فعندما يحدد العقل الأثر بوصفه شيئًا متميزًا، يبدأ التعرّف؛ لكن اللقاء والانتباه يسبقانه. ومن هناك تبدأ الإبستمولوجيا.
      </p>
    </section>

    {/* ═══ وسائل الوصول ═══ */}
    <section id="about-means" className="about_section">
      <h2 className="about_section_title">وسائل الوصول</h2>
      <p className="about_section_body">
        وسيلة الوصول هي أي قناة تصل المراقب بآثار الواقع السريري، لا بالواقع السريري نفسه، إذ لا يستطيع أي مراقب بلوغه مباشرة. يعمل هذا المفهوم في AMCTOSHS على ثلاثة مستويات في آن واحد: إبستيمي، وظاهراتي، وبنيوي. وفهم المستويات الثلاثة ضروري لفهم ما يفعله النظام ولماذا يفعله.
      </p>

      <div className="about_means_level">
        <div className="about_means_level_marker">I</div>
        <div className="about_means_level_body">
          <div className="about_means_level_title">وصول الطبيب إلى المعرفة</div>
          <p className="about_section_body about_section_body--callout">
            لا يملك AMCTOSHS عينين، ولا أذنين، ولا لسانًا، ولا جلدًا، ولا أنفًا. كل ما يملكه هو نص رقمي؛ واللغة نفسها هي بالفعل تحويل لشيء حدث في جسم، وفي غرفة، وبين طبيب ومريض.
          </p>
          <p className="about_section_body about_section_body--callout" style={{ marginTop: "0.75rem" }}>
            لا أحد يلاحظ الشيء ذاته. إنما نلاحظ آثاره فقط.
          </p>
          <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
            <strong>الملاحظة</strong> هي الاتصال المباشر بين المراقب والآثار التي ينتجها الشيء، لا بالشيء نفسه. فالشيء يظل خارج المتناول. وما يواجهه الأطباء دائمًا هو أثر: عرض، أو علامة، أو قياس، أو صورة، أو صوت. أما الشيء — المرض، أو العملية الخلوية، أو العضو الفاشل — فيُستدل عليه من هذه الآثار، ولا يُرى مباشرة.
          </p>
          <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
            <strong>اللغة</strong> هي ما يتوسط الاتصال بين المراقب وتلك الآثار. عندما يكتب الطبيب تقريرًا، فإنه يشفّر ملاحظته للآثار في صيغة يمكن أن تنتقل وتُخزَّن وتُقرأ من جديد. لا تحمل اللغة الآثار نفسها؛ بل تحمل <em>ملاحظة</em> الآثار.
          </p>
          <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
            <strong>AMCTOSHS مراقب متوسَّط باللغة.</strong> لا يمكنه ملاحظة الآثار مباشرة لأنه بُني كليًا بواسطة أنظمة بشرية ولا يملك جهازًا حسيًا خاصًا به. وكل ما يعرفه عن الواقع السريري يأتي عبر لغة أنتجها بشر لاحظوا الآثار بالفعل. والسلسلة الإبستيمية هي:
          </p>
          <ol className="about_trace_chain">
            <li><strong>الشيء</strong> — غير قابل للملاحظة مباشرة، وينتج آثارًا</li>
            <li><strong>الآثار</strong> — ما يواجهه المراقب البشري مباشرة (عرض، علامة، صورة، صوت)</li>
            <li><strong>الملاحظة</strong> — الاتصال المباشر للإنسان بتلك الآثار، وهو يتضمن تأويلًا بالفعل</li>
            <li><strong>اللغة</strong> — تسجل تلك الملاحظة، وتتوسط نقلها إلى شكل قابل للحفظ والقراءة</li>
            <li><strong>AMCTOSHS</strong> — يقرأ اللغة؛ وهو مراقب متوسَّط باللغة لملاحظات آثار</li>
          </ol>
          <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
            وينتج عن ذلك معنى هادئ لكنه عميق بالنسبة لتصنيف البطاقات. فبطاقة <strong>الأشياء</strong> لا تخزن الأشياء ذاتها؛ بل تخزن استدلالات مسمّاة مشتقة من الآثار. وما يسميه AMCTOSHS «شيئًا» هو دائمًا بناء: كيان مفترض لتفسير الآثار التي لوحظت. وبطاقة <strong>الآثار</strong> هي، بهذا المعنى، أولى إبستيميًا، لأنها أقرب إلى ما يواجهه أي مراقب فعليًا. أما الأشياء فهي دائمًا على بُعد خطوة إضافية.
          </p>
          <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
            أما وسيلة الوصول الثانية والأعمق فهي <strong>لقاء المريض</strong> — لقاء مباشر، متجسد، ومتموضع في سياقه. وإلى هناك يتجه AMCTOSHS: ليس لتجاوز اللغة، بل للاقتراب من الآثار نفسها قبل أن تكون اللغة قد قررت معناها مسبقًا.
          </p>
        </div>
      </div>

      <div className="about_means_level">
        <div className="about_means_level_marker">II</div>
        <div className="about_means_level_body">
          <div className="about_means_level_title">وصول المريض إلى خبرته الخاصة</div>
          <p className="about_section_body">
            لا يعيش المريض حالته بوصفها تشخيصًا. بل يعيشها عبر جسده، ومن خلال الحواس الخمس التي تمثل النوافذ الوحيدة المتاحة لأي إنسان على العالم:
          </p>
          <ul className="about_means_senses">
            <li><span className="about_means_sense_name">العين</span> — ما يراه المريض: اللون، والشكل، والحركة، والضوء، والاضطراب البصري</li>
            <li><span className="about_means_sense_name">الأذن</span> — ما يسمعه المريض: الصوت، وطنين الأذن، والصمت، وتغيرات الصوت</li>
            <li><span className="about_means_sense_name">اللسان</span> — ما يتذوقه المريض: طعم معدني، أو مر، أو غياب التذوق، أو تغير التذوق</li>
            <li><span className="about_means_sense_name">الجلد</span> — ما يشعر به المريض: الألم، والضغط، والحرارة، والملمس، والخدر</li>
            <li><span className="about_means_sense_name">الأنف</span> — ما يشمه المريض: الرائحة، وفقد الشم، واضطراب الشم</li>
          </ul>
          <p className="about_section_body" style={{ marginTop: "0.75rem" }}>
            هذه ليست تفاصيل إضافية. إنها البيانات الأولية للواقع السريري الذاتي — الظواهر كما يعيشها المريض فعلًا. وهي ما تفشل اللغة السريرية في حفظه باستمرار.
          </p>
        </div>
      </div>

      <div className="about_means_level">
        <div className="about_means_level_marker">III</div>
        <div className="about_means_level_body">
          <div className="about_means_level_title">الجسر: من الهيولى إلى الظاهرة</div>
          <p className="about_section_body">
            تمثل وسيلة الوصول أيضًا الرابط البنيوي بين مرحلتي AMCTOSHS. فالهيولى المستخرجة من اللغة — مثل <em>إحساس بالحرقان</em> — تبقى غير مثبتة. إنها فئة بلا ذات. لكن حين يقول المريض: <em>نعم، ذلك الإحساس عندي، أشعر به عبر جلدي، وهو مستمر، ويزداد ليلًا</em>، لا تعود الهيولى مادة غير متمايزة. لقد أُعطيت صورة من خلال قناة حسية محددة، وجسد محدد، وزمن محدد.
          </p>
          <p className="about_section_body" style={{ marginTop: "0.6rem" }}>
            وسيلة الوصول — العين، والأذن، واللسان، والجلد، والأنف — هي تحديدًا ما يحول الهيولى المصنفة إلى <strong>ظاهرة معيشة</strong>. ولهذا توجد بطاقة «الظواهر» بوصفها وجهة منفصلة في AMCTOSHS: لا لتخزين ما تقوله النصوص إن المرضى يشعرون به، بل لتسجيل ما يذكر هذا المريض أنه يشعر به، وعبر أي حاسة، وبأي كيفية، وعلى أي مقياس من جسده.
          </p>
        </div>
      </div>
    </section>

    {/* ═══ كيف يعمل ═══ */}
    <section id="about-how" className="about_section">
      <h2 className="about_section_title">كيف يعمل النظام</h2>
      <p className="about_section_body">
        ارفع ملف PDF في صفحة «الهيولات». يستخرج النظام الهيولات ويصنفها ضمن خمس بطاقات — الأشياء، والآثار، والظواهر، والمفاهيم، والنماذج — مع تنظيم كل منها بحسب المقياس البيولوجي (جزيء ← خلية ← نسيج ← عضو ← جهاز ← إنسان).
      </p>
    </section>

    {/* ═══ البطاقات ═══ */}
    <section id="about-cards" className="about_section">
      <h2 className="about_section_title">البطاقات</h2>
      <ul className="about_cards_list">
        <li><span className="about_card_dot" style={{ background: "#4fc3f7" }} />الأشياء — كيانات مادية مستخرجة من النص</li>
        <li><span className="about_card_dot" style={{ background: "#81c784" }} />الآثار — إشارات، وواسمات، ومخرجات قابلة للملاحظة</li>
        <li><span className="about_card_dot" style={{ background: "#f06292" }} />الظواهر — ملاحظات حسية وخبرات معيشة</li>
        <li><span className="about_card_dot" style={{ background: "#ffb74d" }} />المفاهيم — بنى تجريدية ونظرية</li>
        <li><span className="about_card_dot" style={{ background: "#ce93d8" }} />النماذج — تمثيلات وأطر تفسيرية</li>
      </ul>
    </section>

    {/* ═══ أنواع الاستخراج ═══ */}
    <section id="about-types" className="about_section">
      <h2 className="about_section_title">أنواع الاستخراج</h2>
      <p className="about_section_body">
        قبل الاستخراج، تكون الكلمة <strong>هيولى</strong>: مادة غير متمايزة. ويحدد نوع الاستخراج الوحدة اللغوية التي ينبغي للنظام استهدافها.
      </p>

      <div className="about_type_tree">

        <div className="about_type_group">1. المورفيم</div>
        <p className="about_type_desc">أصغر وحدة من المعنى. لا يمكن تفكيكها أكثر من ذلك دون فقدان المعنى.</p>

        <div className="about_type_sub">
          <div className="about_type_group">1.1 الجذر</div>
          <p className="about_type_desc">المورفيم الأساسي الذي يحمل المعنى الأولي للكلمة.</p>
          <ul className="about_type_list">
            <li>
              <span className="about_type_label">1.1.1 حر</span>
              <span className="about_type_note">كلمة بسيطة</span>
              <span className="about_type_desc_inline">— يمكن أن يقف وحده بوصفه كلمة مستقلة. <em>مثال: خلية، قلب، عصب</em></span>
            </li>
            <li>
              <span className="about_type_label">1.1.2 مقيَّد</span>
              <span className="about_type_desc_inline">— لا يوجد إلا ملتصقًا بمورفيم آخر. <em>مثال: cardio-، و-itis</em></span>
            </li>
          </ul>
        </div>

        <div className="about_type_sub">
          <div className="about_type_group">1.2 اللواحق</div>
          <p className="about_type_desc">مورفيمات مقيّدة تُلحق بالجذر لتعديل معناه أو توسيعه.</p>
          <ul className="about_type_list">
            <li>
              <span className="about_type_label">1.2.1 البادئة</span>
              <span className="about_type_desc_inline">— تسبق الجذر. <em>مثال: sub-، وhyper-، وendo-</em></span>
            </li>
            <li>
              <span className="about_type_label">1.2.2 حرف الوصل</span>
              <span className="about_type_desc_inline">— يربط المورفيمات. <em>مثال: الحرف -o- في cardio·logy</em></span>
            </li>
            <li>
              <span className="about_type_label">1.2.3 اللاحقة</span>
              <span className="about_type_desc_inline">— تأتي بعد الجذر. <em>مثال: -ology، و-itis، و-ase</em></span>
            </li>
          </ul>
        </div>

        <div className="about_type_group">2. الكلمة</div>
        <p className="about_type_desc">وحدة قائمة بذاتها، مبنية من مورفيم واحد أو أكثر.</p>
        <div className="about_type_sub">
          <ul className="about_type_list">
            <li>
              <span className="about_type_label">2.1 الكلمة المركبة</span>
              <span className="about_type_desc_inline">— تُبنى من عدة مورفيمات داخل كلمة واحدة. <em>مثال: myocardium، وcardiomyocyte</em></span>
            </li>
          </ul>
        </div>

        <div className="about_type_group">3. المركب اللفظي</div>
        <p className="about_type_desc">
          تركيب ذو معنى من كلمات متتابعة، ينشأ معناه من العلاقة بين أجزائه. ويسمى أيضًا المركب الاسمي أو المصطلح المركب. <em>مثال: myocardial infarction، وT-cell receptor</em>
        </p>

        <div className="about_type_group">4. النسق</div>
        <p className="about_type_desc">
          مجموعة من الصيغ أو المصطلحات ذات الصلة، تُنظم بحسب نمط بنيوي مشترك أو فئة وظيفية مشتركة. <em>مثال: نسق مثبطات الكيناز</em>
        </p>

      </div>
    </section>

  </>
);

export default AboutContentAR;
