/**
 * Dados de demonstração: cria a conta demo@betterclass.app (senha: demo12345)
 * com três aulas já transcritas e manda tudo para a esteira de IA.
 *   npm run seed
 */
import { q, uid, nowISO } from '../db.js';
import { createUser } from '../auth.js';
import { enqueue } from '../services/pipeline.js';

const EMAIL = 'demo@betterclass.app';
const AULAS = [
  {
    course: 'Cálculo I',
    title: 'Teorema fundamental do cálculo',
    transcript: `O teorema fundamental do cálculo é a ponte entre derivação e integração. A primeira parte diz que, se f é contínua
em um intervalo fechado, então a função definida pela integral de a até x de f é derivável e sua derivada é a própria f.
A segunda parte é a que vocês vão usar na prova: se F é uma primitiva de f, então a integral definida de a até b de f é F(b) menos F(a).
Atenção: a condição de continuidade no intervalo fechado é essencial, sem ela o teorema não se aplica.
Em resumo, calcular uma integral definida vira achar uma primitiva e avaliar nos extremos. Um erro comum é esquecer de trocar
os limites de integração quando fazemos substituição de variável. Portanto, ao usar substituição, sempre ajuste os limites
ou volte para a variável original antes de avaliar.`,
  },
  {
    course: 'Algoritmos',
    title: 'Complexidade e notação assintótica',
    transcript: `A notação O grande descreve o comportamento do tempo de execução quando a entrada cresce. Dizemos que um algoritmo é
O de n quando o tempo cresce proporcionalmente ao tamanho da entrada. A busca binária é O de log n porque descarta metade
do espaço de busca a cada passo. Já a ordenação por comparação tem limite inferior de n log n, e isso cai na prova.
O quicksort é n log n no caso médio, mas o pior caso é n ao quadrado quando o pivô é sempre o menor elemento.
Portanto, a escolha do pivô importa. Em resumo, analisem sempre o pior caso, o caso médio e o consumo de memória.
Um erro comum é confundir complexidade de tempo com complexidade de espaço.`,
  },
  {
    course: 'Anatomia',
    title: 'Sistema circulatório — visão geral',
    transcript: `O coração é o órgão muscular que bombeia sangue para todo o corpo. O sangue sai do ventrículo esquerdo pela artéria aorta
e retorna ao átrio direito pelas veias cavas. A circulação pulmonar leva sangue do ventrículo direito até os pulmões,
onde ocorre a hematose, e traz o sangue oxigenado de volta ao átrio esquerdo. As valvas atrioventriculares impedem o refluxo
de sangue durante a sístole. Atenção: a valva tricúspide fica do lado direito e a valva mitral do lado esquerdo, isso cai na prova.
Em resumo, artérias levam sangue para fora do coração e veias trazem sangue de volta, independentemente da oxigenação.`,
  },
];

let user = q.get('SELECT * FROM users WHERE email = ?', EMAIL);
if (!user) {
  user = createUser({ name: 'Aluno Demo', email: EMAIL, password: 'demo12345' });
  console.log(`  conta criada: ${EMAIL} / demo12345`);
} else {
  console.log(`  conta já existia: ${EMAIL}`);
}

for (const aula of AULAS) {
  let course = q.get('SELECT * FROM courses WHERE user_id = ? AND name = ?', user.id, aula.course);
  if (!course) {
    const id = uid('c_');
    q.run('INSERT INTO courses (id, user_id, name, professor, color, created_at) VALUES (?,?,?,?,?,?)',
      id, user.id, aula.course, '', 'blue', nowISO());
    course = q.get('SELECT * FROM courses WHERE id = ?', id);
  }
  if (q.get('SELECT id FROM lectures WHERE user_id = ? AND title = ?', user.id, aula.title)) {
    console.log(`  · "${aula.title}" já existe, pulando`);
    continue;
  }
  const id = uid('l_');
  const stamp = nowISO();
  q.run(
    `INSERT INTO lectures (id, user_id, course_id, title, status, started_at, ended_at, duration_ms, transcript, transcript_source, created_at, updated_at)
     VALUES (?,?,?,?,'processing',?,?,?,?,'demo',?,?)`,
    id, user.id, course.id, aula.title, stamp, stamp, 50 * 60 * 1000, aula.transcript, stamp, stamp,
  );
  enqueue(id, user.id);
  console.log(`  · "${aula.title}" enfileirada`);
}

console.log('\n  Processando… (aguarde alguns segundos e abra http://localhost:3000/entrar)\n');
setTimeout(() => process.exit(0), 4000);
